/**
 * Anonymous, opt-out usage telemetry (PILOT-330).
 *
 * Without usage numbers there is no way to tell five users from five
 * thousand, so nothing to prioritise against. This module reports the
 * minimum needed for that: one event per test-file run (which run mode,
 * which platform, how many tests passed/failed, how long it took) plus a
 * one-off `install` event when a machine's anonymous id is first created,
 * each stamped with the SDK, Node and OS versions.
 *
 * What is deliberately NOT collected: test names, selectors, app or package
 * identifiers, file paths, device serials, hostnames, usernames, IP-derived
 * location — anything that could identify a project or a person. The
 * payload is a closed set of fields (see {@link TelemetryPayload}), and the
 * unit tests assert exactly that key set so an accidental widening fails CI.
 *
 * Opt out with `telemetry: false` in `tapsmith.config.ts`, or with
 * `TAPSMITH_TELEMETRY=0` (also honoured: the `DO_NOT_TRACK` convention).
 * A one-time notice is printed on the first run so nobody learns about this
 * from a network log. See `docs/telemetry.md`.
 *
 * Every send is fire-and-forget, bounded by a short timeout, and swallows
 * every error: telemetry must never slow a run down, print a warning, or
 * change an exit code — offline CI machines included.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TapsmithConfig } from './config.js';

// ─── Types ───

/**
 * Which embedder ran the file. One value per run path (see CLAUDE.md, "The
 * five run paths"); UI mode's own watch and MCP re-runs all go through the
 * UI worker and so count as `ui`.
 */
export type RunMode = 'test' | 'test-parallel' | 'ui' | 'watch' | 'mcp';

/** What a completed test-file run reports. Counts only — never names. */
export interface TelemetryRunEvent {
  mode: RunMode;
  platform: 'android' | 'ios';
  /** Size of the device group the file ran on (1 for ordinary projects). */
  devices: number;
  tests: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

/**
 * The complete wire payload — nothing outside this set is ever sent. It is a
 * PostHog capture envelope (`POST /i/v0/e/`): the processor is PostHog's EU
 * cloud, and any PostHog-compatible endpoint (a self-hosted instance, a
 * proxy) can receive it via `TAPSMITH_TELEMETRY_ENDPOINT`.
 */
export interface TelemetryPayload {
  /** PostHog project token — public by design, like every PostHog client key. */
  api_key: string;
  event: 'tapsmith install' | 'tapsmith run';
  /** Random UUID stored in `~/.tapsmith/telemetry.json`; not derived from anything. */
  distinct_id: string;
  timestamp: string;
  properties: TelemetryProperties;
}

/** Event properties. Flat, so PostHog can break down and filter on each. */
export interface TelemetryProperties {
  /** Random per-process id so a run's files can be grouped; never persisted. */
  session_id: string;
  sdk_version: string;
  node_version: string;
  os: NodeJS.Platform;
  arch: string;
  ci: boolean;
  /** Which client sent it, PostHog's convention. */
  $lib: 'tapsmith';
  $lib_version: string;
  /** Never derive a location from the connection (belt; the project setting that discards IPs is braces). */
  $geoip_disable: true;
  /** Anonymous events: no person profile is ever built for the id. */
  $process_person_profile: false;
  // `tapsmith run` only:
  mode?: RunMode;
  platform?: 'android' | 'ios';
  devices?: number;
  tests?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  duration_ms?: number;
}

interface TelemetryState {
  anonymousId: string;
  createdAt: string;
  noticeShown: boolean;
  /** Machine-wide switch set by `tapsmith telemetry enable|disable`. Absent means on. */
  enabled?: boolean;
}

export interface TelemetryOptions {
  /** Where the anonymous id and notice flag live. Default `~/.tapsmith/telemetry.json`. */
  stateFile?: string;
  /** Collector URL. Default: `TAPSMITH_TELEMETRY_ENDPOINT`, else the public collector. */
  endpoint?: string;
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  sdkVersion?: string;
  /** PostHog project token. Default: the Tapsmith project's. Empty disables sending (dry runs still print). */
  apiKey?: string;
  /** Where the first-run notice is written. Default: stderr. */
  writeNotice?: (text: string) => void;
  /** Where `TAPSMITH_TELEMETRY_DEBUG` dry-run payloads are written. Default: stderr. */
  writeDebug?: (text: string) => void;
}

/** Why telemetry is off, in precedence order: the first that applies wins. */
export type TelemetryOffReason = 'env' | 'config' | 'machine';

/** What `tapsmith telemetry status` reports. */
export interface TelemetryStatus {
  enabled: boolean;
  /** Set only when `enabled` is false. */
  reason?: TelemetryOffReason;
  /** True when `TAPSMITH_TELEMETRY_DEBUG` is set: payloads print to stderr and nothing is sent. */
  debug: boolean;
  stateFile: string;
  /** Present once the machine has an id (absent on a machine that has never run or has opted out first). */
  anonymousId?: string;
  endpoint: string;
}

// ─── Constants ───

export const TELEMETRY_DOCS_URL = 'https://tapsmith.dev/reference/telemetry/';
/** PostHog EU cloud single-event capture. */
const DEFAULT_ENDPOINT = 'https://eu.i.posthog.com/i/v0/e/';
/**
 * The Tapsmith PostHog project token. Public by design (every PostHog client
 * ships one); it can only write events, never read them. Empty until the
 * project exists — with no key nothing is sent, so a build from source
 * before then is silent rather than erroring.
 */
const POSTHOG_PROJECT_KEY = '';
const SEND_TIMEOUT_MS = 3_000;
/** Stop trying for the rest of the process after this many consecutive failures. */
const MAX_CONSECUTIVE_FAILURES = 3;
const FALSEY = new Set(['0', 'false', 'no', 'off']);

// ─── Version ───

/** The SDK's own version, read from the package manifest next to `dist/` (or `src/`). */
export function readSdkVersion(): string {
  try {
    const pkgPath = path.resolve(import.meta.dirname, '../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// ─── Enablement ───

function envDisables(env: NodeJS.ProcessEnv): boolean {
  const flag = env.TAPSMITH_TELEMETRY?.trim().toLowerCase();
  if (flag !== undefined && FALSEY.has(flag)) return true;
  const dnt = env.DO_NOT_TRACK?.trim().toLowerCase();
  if (dnt !== undefined && dnt !== '' && !FALSEY.has(dnt)) return true;
  return false;
}

/**
 * Whether telemetry is on for this process and config. The env var wins
 * over the config key in both directions so a CI job can switch it off
 * without touching a shared config, and a machine-wide `DO_NOT_TRACK` is
 * respected as the wider tooling ecosystem does.
 */
export function isTelemetryEnabled(
  config: Pick<TapsmithConfig, 'telemetry'> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (envDisables(env)) return false;
  return config?.telemetry !== false;
}

function isCI(env: NodeJS.ProcessEnv): boolean {
  return !!(env.CI && env.CI !== 'false');
}

/** `TAPSMITH_TELEMETRY_DEBUG` set to anything but an explicit false. */
function isDebug(env: NodeJS.ProcessEnv): boolean {
  const flag = env.TAPSMITH_TELEMETRY_DEBUG?.trim().toLowerCase();
  return flag !== undefined && flag !== '' && !FALSEY.has(flag);
}

// ─── Client ───

export class Telemetry {
  private readonly _stateFile: string;
  private readonly _endpoint: string;
  private readonly _env: NodeJS.ProcessEnv;
  private readonly _fetch: typeof fetch;
  private readonly _writeNotice: (text: string) => void;
  private readonly _writeDebug: (text: string) => void;
  private readonly _sessionId = randomUUID();
  private readonly _apiKey: string;
  private _sdkVersion: string | undefined;
  private _state: TelemetryState | undefined;
  private readonly _pending = new Set<Promise<void>>();
  private _consecutiveFailures = 0;

  constructor(opts: TelemetryOptions = {}) {
    this._env = opts.env ?? process.env;
    this._stateFile = opts.stateFile ?? defaultStateFile();
    this._endpoint = opts.endpoint ?? this._env.TAPSMITH_TELEMETRY_ENDPOINT ?? DEFAULT_ENDPOINT;
    this._fetch = opts.fetchFn ?? ((input, init) => fetch(input, init));
    this._sdkVersion = opts.sdkVersion;
    this._apiKey = opts.apiKey ?? POSTHOG_PROJECT_KEY;
    this._writeNotice = opts.writeNotice ?? ((text) => process.stderr.write(text));
    this._writeDebug = opts.writeDebug ?? ((text) => process.stderr.write(text));
  }

  /**
   * Whether this process will report. Env and config (see
   * {@link isTelemetryEnabled}) are checked first, then the machine-wide
   * switch `tapsmith telemetry disable` writes into the state file. Reading
   * the switch never creates the file: a machine that opted out before its
   * first run gets no id and sends no `install`.
   */
  isEnabled(config: Pick<TapsmithConfig, 'telemetry'> | undefined): boolean {
    return this.status(config).enabled;
  }

  /** The effective state and, when off, the single reason that decided it. */
  status(config: Pick<TapsmithConfig, 'telemetry'> | undefined): TelemetryStatus {
    const state = this._peekState();
    const base = {
      debug: isDebug(this._env),
      stateFile: this._stateFile,
      anonymousId: state?.anonymousId,
      endpoint: this._endpoint,
    };
    if (envDisables(this._env)) return { ...base, enabled: false, reason: 'env' };
    if (config?.telemetry === false) return { ...base, enabled: false, reason: 'config' };
    if (state?.enabled === false) return { ...base, enabled: false, reason: 'machine' };
    return { ...base, enabled: true };
  }

  /**
   * Flip the machine-wide switch (`tapsmith telemetry enable|disable`).
   * Returns false when the state file cannot be written, in which case the
   * caller should point at the environment variable instead. Never sends:
   * a machine that opts out before its first run is not an install, and one
   * that opts back in has already been counted or never will be.
   */
  setMachineEnabled(enabled: boolean): boolean {
    const current = this._peekState()
      ?? { anonymousId: randomUUID(), createdAt: new Date().toISOString(), noticeShown: false };
    // Someone who ran `enable` by hand has read the docs; the notice would
    // only repeat them.
    return this._saveState({ ...current, enabled, noticeShown: current.noticeShown || enabled });
  }

  /**
   * Print the one-time notice if this machine has never seen it, and record
   * that it was shown. Call from the user-facing parent process (the CLI,
   * the MCP server) before the first run — never from a forked child, whose
   * stderr may be captured or interleaved. Returns true when it printed.
   */
  printNoticeIfFirstRun(config: Pick<TapsmithConfig, 'telemetry'> | undefined): boolean {
    if (!this.isEnabled(config)) return false;
    const state = this._loadState();
    if (state.noticeShown) return false;
    this._writeNotice(telemetryNoticeText());
    this._saveState({ ...state, noticeShown: true });
    return true;
  }

  /**
   * Report one completed test-file run. Fire-and-forget: returns
   * immediately, never throws, never logs.
   */
  recordRun(config: Pick<TapsmithConfig, 'telemetry'> | undefined, run: TelemetryRunEvent): void {
    if (!this.isEnabled(config)) return;
    try {
      this._send(this._payload('run', run));
    } catch {
      // Telemetry never surfaces.
    }
  }

  /**
   * Wait (briefly) for in-flight sends so a process that is about to
   * `process.exit()` does not systematically drop its last event. Bounded:
   * an unreachable collector costs at most `maxWaitMs`.
   */
  async flush(maxWaitMs = 750): Promise<void> {
    if (this._pending.size === 0) return;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, maxWaitMs);
      timer.unref();
    });
    try {
      await Promise.race([Promise.allSettled([...this._pending]), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** @internal — for tests. */
  get pendingCount(): number {
    return this._pending.size;
  }

  // ─── Internals ───

  private _payload(event: 'install' | 'run', run?: TelemetryRunEvent): TelemetryPayload {
    const sdkVersion = this._sdkVersion ?? (this._sdkVersion = readSdkVersion());
    const properties: TelemetryProperties = {
      session_id: this._sessionId,
      sdk_version: sdkVersion,
      node_version: process.version,
      os: process.platform,
      arch: process.arch,
      ci: isCI(this._env),
      $lib: 'tapsmith',
      $lib_version: sdkVersion,
      $geoip_disable: true,
      $process_person_profile: false,
    };
    if (run) {
      properties.mode = run.mode;
      properties.platform = run.platform;
      properties.devices = run.devices;
      properties.tests = run.tests;
      properties.passed = run.passed;
      properties.failed = run.failed;
      properties.skipped = run.skipped;
      properties.duration_ms = run.durationMs;
    }
    return {
      api_key: this._apiKey,
      event: event === 'run' ? 'tapsmith run' : 'tapsmith install',
      distinct_id: this._loadState().anonymousId,
      timestamp: new Date().toISOString(),
      properties,
    };
  }

  private _send(payload: TelemetryPayload): void {
    if (isDebug(this._env)) {
      // Dry run: show exactly what would have gone over the wire, send nothing.
      this._writeDebug(`[telemetry] ${JSON.stringify(payload)}\n`);
      return;
    }
    // No project token compiled in (a source build before the project
    // existed): there is nowhere to send to.
    if (!this._apiKey) return;
    if (this._consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return;
    const attempt = (async () => {
      try {
        const res = await this._fetch(this._endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
        if (res.ok) this._consecutiveFailures = 0;
        else this._consecutiveFailures++;
        // Drain so the connection can be reused/closed promptly.
        await res.arrayBuffer().catch(() => undefined);
      } catch {
        this._consecutiveFailures++;
      }
    })();
    this._pending.add(attempt);
    void attempt.finally(() => this._pending.delete(attempt));
  }

  /**
   * Load (or create) the persisted state. A fresh file means a new machine
   * or a wiped home directory: that is the `install` we count. Any read or
   * write failure degrades to an in-memory id for this process only.
   */
  private _loadState(): TelemetryState {
    const existing = this._peekState();
    if (existing) return existing;
    const fresh: TelemetryState = { anonymousId: randomUUID(), createdAt: new Date().toISOString(), noticeShown: false };
    // `_saveState` records `fresh` as the current state whether or not the
    // write lands, so `_payload` below sees the id without re-reading.
    const persisted = this._saveState(fresh);
    // Only a persisted id is an install: an ephemeral one would count the
    // same machine again on every process.
    if (persisted) {
      try {
        this._send(this._payload('install'));
      } catch {
        // Telemetry never surfaces.
      }
    }
    return fresh;
  }

  /** The persisted state if there is one — no file is created, nothing is sent. */
  private _peekState(): TelemetryState | undefined {
    if (this._state) return this._state;
    const existing = readState(this._stateFile);
    if (existing) this._state = existing;
    return existing;
  }

  private _saveState(state: TelemetryState): boolean {
    this._state = state;
    try {
      fs.mkdirSync(path.dirname(this._stateFile), { recursive: true });
      // Write-then-rename so a concurrent worker never reads a torn file.
      const tmp = `${this._stateFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
      fs.renameSync(tmp, this._stateFile);
      return true;
    } catch {
      return false;
    }
  }
}

function readState(file: string): TelemetryState | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<TelemetryState>;
    if (typeof raw.anonymousId !== 'string' || raw.anonymousId.length === 0) return undefined;
    return {
      anonymousId: raw.anonymousId,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
      noticeShown: raw.noticeShown === true,
      ...(typeof raw.enabled === 'boolean' ? { enabled: raw.enabled } : {}),
    };
  } catch {
    return undefined;
  }
}

function defaultStateFile(): string {
  const home = os.homedir();
  if (home) return path.join(home, '.tapsmith', 'telemetry.json');
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
  return path.join(os.tmpdir(), `tapsmith-${uid}`, 'telemetry.json');
}

/** The first-run notice, verbatim. */
export function telemetryNoticeText(): string {
  return [
    '',
    'Tapsmith collects anonymous usage data to guide development: SDK, Node and OS',
    'versions, platform (Android/iOS), run mode, and pass/fail counts per run.',
    'It never sends test names, selectors, app identifiers, or file paths.',
    'Opt out with `tapsmith telemetry disable`, TAPSMITH_TELEMETRY=0, or',
    '`telemetry: false` in tapsmith.config.ts. `tapsmith telemetry status` shows the',
    `current setting. Details: ${TELEMETRY_DOCS_URL}`,
    '',
  ].join('\n') + '\n';
}

/** Build the run event for a finished file from its results. */
export function runEventFromResults(
  results: ReadonlyArray<{ status: 'passed' | 'failed' | 'skipped'; durationMs: number }>,
  base: Pick<TelemetryRunEvent, 'mode' | 'platform' | 'devices'>,
  durationMs: number,
): TelemetryRunEvent {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of results) {
    if (r.status === 'passed') passed++;
    else if (r.status === 'failed') failed++;
    else skipped++;
  }
  return { ...base, tests: results.length, passed, failed, skipped, durationMs: Math.round(durationMs) };
}

// ─── Process-wide client ───

/**
 * The one client every run path shares. Tests construct their own
 * {@link Telemetry} with a temp state file and a fake `fetchFn`; the runner's
 * tests spy on this instance's `recordRun`.
 */
export const telemetry = new Telemetry();
