import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  Telemetry,
  isTelemetryEnabled,
  runEventFromResults,
  telemetryNoticeText,
  readSdkVersion,
  TELEMETRY_DOCS_URL,
  type TelemetryPayload,
  type TelemetryRunEvent,
} from '../telemetry.js';

const RUN: TelemetryRunEvent = {
  mode: 'test', platform: 'android', devices: 1, tests: 3, passed: 2, failed: 1, skipped: 0, durationMs: 1234,
};

/** The complete, closed set of top-level payload keys. Widening it is a deliberate act. */
const PAYLOAD_KEYS = ['event', 'anonymousId', 'sessionId', 'timestamp', 'sdkVersion', 'nodeVersion', 'os', 'arch', 'ci', 'run'].sort();
const RUN_KEYS = ['mode', 'platform', 'devices', 'tests', 'passed', 'failed', 'skipped', 'durationMs'].sort();

let tempDir: string;
let stateFile: string;

function fakeFetch(status = 200) {
  const calls: Array<{ url: string; init: RequestInit; body: TelemetryPayload }> = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init!, body: JSON.parse(String(init!.body)) as TelemetryPayload });
    return new Response('', { status });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

function make(opts: {
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  notices?: string[];
  endpoint?: string;
} = {}): Telemetry {
  return new Telemetry({
    stateFile,
    endpoint: opts.endpoint ?? 'https://collector.test/v1/events',
    env: opts.env ?? {},
    fetchFn: opts.fetchFn ?? fakeFetch().fn,
    sdkVersion: '9.9.9',
    writeNotice: (text) => opts.notices?.push(text),
  });
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tapsmith-telemetry-'));
  stateFile = path.join(tempDir, 'nested', 'telemetry.json');
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('isTelemetryEnabled()', () => {
  it('is on by default, including when there is no config at all', () => {
    expect(isTelemetryEnabled(undefined, {})).toBe(true);
    expect(isTelemetryEnabled({}, {})).toBe(true);
    expect(isTelemetryEnabled({ telemetry: true }, {})).toBe(true);
  });

  it('honours the config opt-out', () => {
    expect(isTelemetryEnabled({ telemetry: false }, {})).toBe(false);
  });

  it.each(['0', 'false', 'FALSE', 'no', 'off', ' 0 '])('honours TAPSMITH_TELEMETRY=%j', (value) => {
    expect(isTelemetryEnabled({}, { TAPSMITH_TELEMETRY: value })).toBe(false);
  });

  it.each(['1', 'true', 'yes', ''])('treats TAPSMITH_TELEMETRY=%j as opted in', (value) => {
    expect(isTelemetryEnabled({}, { TAPSMITH_TELEMETRY: value })).toBe(true);
  });

  it('honours the DO_NOT_TRACK convention (any value but an explicit false)', () => {
    expect(isTelemetryEnabled({}, { DO_NOT_TRACK: '1' })).toBe(false);
    expect(isTelemetryEnabled({}, { DO_NOT_TRACK: 'true' })).toBe(false);
    expect(isTelemetryEnabled({}, { DO_NOT_TRACK: '0' })).toBe(true);
    expect(isTelemetryEnabled({}, { DO_NOT_TRACK: '' })).toBe(true);
  });

  it('lets the env var win over the config key in both directions', () => {
    // A CI job can switch it off without touching a shared config…
    expect(isTelemetryEnabled({ telemetry: true }, { TAPSMITH_TELEMETRY: '0' })).toBe(false);
    // …but an env var cannot override an explicit config opt-out.
    expect(isTelemetryEnabled({ telemetry: false }, { TAPSMITH_TELEMETRY: '1' })).toBe(false);
  });
});

describe('Telemetry state file', () => {
  it('creates a random anonymous id on first use and reuses it afterwards', async () => {
    const first = fakeFetch();
    const a = make({ fetchFn: first.fn });
    a.recordRun({}, RUN);
    await a.flush();

    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    expect(state.anonymousId).toMatch(/^[0-9a-f-]{36}$/);
    expect(state.noticeShown).toBe(false);
    // Owner-only: the id is the one thing that could correlate a machine's runs.
    if (process.platform !== 'win32') {
      expect(fs.statSync(stateFile).mode & 0o777).toBe(0o600);
    }

    const second = fakeFetch();
    const b = make({ fetchFn: second.fn });
    b.recordRun({}, RUN);
    await b.flush();
    expect(second.calls[0].body.anonymousId).toBe(state.anonymousId);
    // A second process on the same machine is not a second install.
    expect(second.calls.map((c) => c.body.event)).toEqual(['run']);
  });

  it('sends an install event exactly when the id is first persisted', async () => {
    const { fn, calls } = fakeFetch();
    const t = make({ fetchFn: fn });
    t.recordRun({}, RUN);
    await t.flush();
    expect(calls.map((c) => c.body.event)).toEqual(['install', 'run']);
    expect(calls[0].body.run).toBeUndefined();
    expect(calls[0].body.anonymousId).toBe(calls[1].body.anonymousId);
    expect(calls[0].body.sessionId).toBe(calls[1].body.sessionId);
  });

  it('regenerates a corrupt or empty state file', async () => {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, '{not json');
    const { fn, calls } = fakeFetch();
    make({ fetchFn: fn }).recordRun({}, RUN);
    await Promise.resolve();
    expect(calls[0].body.anonymousId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(fs.readFileSync(stateFile, 'utf-8')).anonymousId).toBe(calls[0].body.anonymousId);

    fs.writeFileSync(stateFile, JSON.stringify({ anonymousId: '' }));
    const again = fakeFetch();
    make({ fetchFn: again.fn }).recordRun({}, RUN);
    await Promise.resolve();
    expect(again.calls[0].body.anonymousId).not.toBe('');
  });

  it('falls back to an ephemeral id (and sends no install) when the state cannot be written', async () => {
    // A regular file where the directory should be: mkdir -p fails.
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'nested'), 'in the way');
    const { fn, calls } = fakeFetch();
    const t = make({ fetchFn: fn });
    t.recordRun({}, RUN);
    await t.flush();
    expect(calls.map((c) => c.body.event)).toEqual(['run']);
    expect(calls[0].body.anonymousId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('writes nothing at all when disabled', async () => {
    const { fn } = fakeFetch();
    const t = make({ fetchFn: fn, env: { TAPSMITH_TELEMETRY: '0' } });
    t.recordRun({}, RUN);
    expect(t.printNoticeIfFirstRun({})).toBe(false);
    await t.flush();
    expect(fn).not.toHaveBeenCalled();
    expect(fs.existsSync(stateFile)).toBe(false);
  });
});

describe('Telemetry.recordRun()', () => {
  it('POSTs JSON to the endpoint with exactly the documented fields', async () => {
    const { fn, calls } = fakeFetch();
    const t = make({ fetchFn: fn, env: { CI: 'true' } });
    t.recordRun({ telemetry: true }, RUN);
    await t.flush();

    const run = calls.find((c) => c.body.event === 'run')!;
    expect(run.url).toBe('https://collector.test/v1/events');
    expect(run.init.method).toBe('POST');
    expect((run.init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(run.init.signal).toBeInstanceOf(AbortSignal);

    expect(Object.keys(run.body).sort()).toEqual(PAYLOAD_KEYS);
    expect(Object.keys(run.body.run!).sort()).toEqual(RUN_KEYS);
    expect(run.body).toMatchObject({
      event: 'run',
      sdkVersion: '9.9.9',
      nodeVersion: process.version,
      os: process.platform,
      arch: process.arch,
      ci: true,
      run: RUN,
    });
    expect(Date.parse(run.body.timestamp)).not.toBeNaN();
    expect(run.body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(run.body.sessionId).not.toBe(run.body.anonymousId);
  });

  it('reads the endpoint from TAPSMITH_TELEMETRY_ENDPOINT when not given explicitly', async () => {
    const { fn, calls } = fakeFetch();
    const t = new Telemetry({
      stateFile,
      env: { TAPSMITH_TELEMETRY_ENDPOINT: 'http://127.0.0.1:1/x' },
      fetchFn: fn,
      sdkVersion: '1.0.0',
      writeNotice: () => undefined,
    });
    t.recordRun({}, RUN);
    await t.flush();
    expect(calls[0].url).toBe('http://127.0.0.1:1/x');
  });

  it('reports ci=false when CI is unset or "false"', async () => {
    for (const env of [{}, { CI: 'false' }]) {
      const { fn, calls } = fakeFetch();
      const t = make({ fetchFn: fn, env });
      t.recordRun({}, RUN);
      await t.flush();
      expect(calls.at(-1)!.body.ci).toBe(false);
    }
  });

  it('does nothing when the config opts out', async () => {
    const { fn } = fakeFetch();
    const t = make({ fetchFn: fn });
    t.recordRun({ telemetry: false }, RUN);
    await t.flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it('never throws or rejects when the collector is unreachable', async () => {
    const fn = vi.fn(async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    const t = make({ fetchFn: fn });
    expect(() => t.recordRun({}, RUN)).not.toThrow();
    await expect(t.flush()).resolves.toBeUndefined();
    expect(fn).toHaveBeenCalled();
  });

  it('never throws when fetch itself throws synchronously', async () => {
    const fn = vi.fn(() => { throw new Error('boom'); }) as unknown as typeof fetch;
    const t = make({ fetchFn: fn });
    expect(() => t.recordRun({}, RUN)).not.toThrow();
    await expect(t.flush()).resolves.toBeUndefined();
  });

  it('stops trying for the rest of the process after three consecutive failures', async () => {
    const fn = vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    const t = make({ fetchFn: fn });
    for (let i = 0; i < 6; i++) {
      t.recordRun({}, RUN);
      await t.flush();
    }
    // install + 2 runs = 3 failures, then silence.
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('resets the failure count on a success', async () => {
    let status = 500;
    const fn = vi.fn(async () => new Response('', { status })) as unknown as typeof fetch;
    const t = make({ fetchFn: fn });
    t.recordRun({}, RUN); // install (500) + run (500)
    await t.flush();
    status = 200;
    t.recordRun({}, RUN); // ok → counter back to 0
    await t.flush();
    status = 500;
    for (let i = 0; i < 4; i++) {
      t.recordRun({}, RUN);
      await t.flush();
    }
    // 2 failures, 1 success, then 3 more failures allowed = 6 calls.
    expect(fn).toHaveBeenCalledTimes(6);
  });
});

describe('Telemetry.flush()', () => {
  it('waits for in-flight sends', async () => {
    let resolveSend!: () => void;
    const gate = new Promise<void>((r) => { resolveSend = r; });
    const fn = vi.fn(async () => { await gate; return new Response('', { status: 200 }); }) as unknown as typeof fetch;
    const t = make({ fetchFn: fn });
    t.recordRun({}, RUN);
    expect(t.pendingCount).toBeGreaterThan(0);
    let flushed = false;
    const flushing = t.flush(10_000).then(() => { flushed = true; });
    await Promise.resolve();
    expect(flushed).toBe(false);
    resolveSend();
    await flushing;
    expect(flushed).toBe(true);
    expect(t.pendingCount).toBe(0);
  });

  it('gives up after the bound so a hung collector cannot hold the process', async () => {
    const fn = vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const t = make({ fetchFn: fn });
    t.recordRun({}, RUN);
    const started = Date.now();
    await t.flush(50);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('resolves immediately when nothing is pending', async () => {
    await expect(make().flush()).resolves.toBeUndefined();
  });
});

describe('Telemetry.printNoticeIfFirstRun()', () => {
  it('prints once per machine and records that it did', () => {
    const notices: string[] = [];
    const a = make({ notices });
    expect(a.printNoticeIfFirstRun({})).toBe(true);
    expect(a.printNoticeIfFirstRun({})).toBe(false);
    expect(notices).toEqual([telemetryNoticeText()]);
    expect(JSON.parse(fs.readFileSync(stateFile, 'utf-8')).noticeShown).toBe(true);

    // A later process (a child, the next day's run) stays quiet.
    const later: string[] = [];
    expect(make({ notices: later }).printNoticeIfFirstRun({})).toBe(false);
    expect(later).toEqual([]);
  });

  it('prints nothing when opted out, and does not mark the notice as shown', () => {
    const notices: string[] = [];
    expect(make({ notices, env: { TAPSMITH_TELEMETRY: '0' } }).printNoticeIfFirstRun({})).toBe(false);
    expect(make({ notices }).printNoticeIfFirstRun({ telemetry: false })).toBe(false);
    expect(notices).toEqual([]);
    // Opting back in later still gets the notice.
    expect(make({ notices }).printNoticeIfFirstRun({})).toBe(true);
  });

  it('says how to opt out and where the details are', () => {
    const text = telemetryNoticeText();
    expect(text).toContain('telemetry: false');
    expect(text).toContain('TAPSMITH_TELEMETRY=0');
    expect(text).toContain(TELEMETRY_DOCS_URL);
    expect(text).toMatch(/never sends test names, selectors, app identifiers, or file paths/);
  });
});

describe('runEventFromResults()', () => {
  it('tallies statuses and rounds the duration', () => {
    const event = runEventFromResults(
      [
        { status: 'passed', durationMs: 1 },
        { status: 'passed', durationMs: 1 },
        { status: 'failed', durationMs: 1 },
        { status: 'skipped', durationMs: 1 },
      ],
      { mode: 'ui', platform: 'ios', devices: 2 },
      1234.6,
    );
    expect(event).toEqual({ mode: 'ui', platform: 'ios', devices: 2, tests: 4, passed: 2, failed: 1, skipped: 1, durationMs: 1235 });
  });
});

describe('readSdkVersion()', () => {
  it('reads the package version', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf-8'));
    expect(readSdkVersion()).toBe(pkg.version);
  });
});
