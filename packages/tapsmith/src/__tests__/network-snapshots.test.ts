import { expect, it } from 'vitest';
import { NetworkSnapshots } from '../trace/network-snapshots.js';
import { createNetworkBodyEncoder } from '../ui-mode/encode-bodies.js';
import { mergeNetworkBodies } from '../ui-mode/network-bodies.js';
import type { NetworkEntry } from '../trace/types.js';

const raw = (captureId = 'session:1', responseBody = Buffer.from('first')) => ({
  captureId, method: 'GET', url: 'http://test/Listen', statusCode: 200, contentType: 'text/plain',
  requestSize: 0, responseSize: responseBody.length, startTimeMs: 1, durationMs: 1,
  requestHeadersJson: '{}', responseHeadersJson: '{}', requestBody: Buffer.alloc(0), responseBody,
  isHttps: false, routeAction: '', inFlight: true,
});

it('retains omitted bytes while metadata progresses, and reuses equal final buffers', () => {
  const cache = new NetworkSnapshots();
  cache.update([raw()]);
  const original = cache.entries[0].responseBody;
  cache.update([{ ...raw(), responseBody: Buffer.alloc(0), responseBodyOmitted: true, durationMs: 100, responseSize: 9000 }]);
  expect(cache.entries[0].responseBody).toBe(original);
  expect(cache.entries[0].durationMs).toBe(100);
  expect(cache.knownBodies()[0].responseBodySize).toBe(5);
  cache.update([{ ...raw(), inFlight: false }]);
  expect(cache.entries[0].responseBody).toBe(original);
  cache.update([raw('new-session:1', Buffer.from('other'))]);
  expect(cache.entries[0].responseBody.toString()).toBe('other');
  cache.update([raw('new-session:1', Buffer.alloc(0))]);
  expect(cache.entries[0].responseBody.length).toBe(0);
  cache.update([]);
  expect(cache.knownBodies()).toEqual([]);
});

it('sends large unchanged bodies once, bounds each message, and resets body identities', () => {
  const encode = createNetworkBodyEncoder();
  const entries = Array.from({ length: 40 }, (_, index) => ({ index, responseBody: Buffer.alloc(200 * 1024, index) } as NetworkEntry));
  const first = [...encode(entries)];
  expect(first.length).toBeGreaterThan(1);
  let transferred = 0;
  for (const msg of first) {
    const bytes = Object.values(msg.bodies).reduce((n, body) => n + body.length, 0);
    expect(bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    transferred += bytes;
  }
  expect(transferred).toBe(40 * Math.ceil(200 * 1024 / 3) * 4);
  for (let tick = 0; tick < 10; tick++) expect([...encode(entries)][0].bodies).toEqual({});
  entries[3] = { ...entries[3], responseBody: Buffer.from('grown') };
  expect(Object.keys([...encode(entries)][0].bodies)).toEqual(['network/res-3.bin']);
  expect([...encode([])][0].entries).toEqual([]);
  expect(Object.keys([...encode(entries)].flatMap((msg) => Object.keys(msg.bodies)))).toHaveLength(40);
});

it('retains patches for reconnect, prunes removed bodies, and clears retry/full snapshot data', () => {
  const entries = [{ responseBodyPath: 'res', requestBodyPath: 'req' }];
  const previous = new Map([['res', 'first'], ['req', 'request'], ['removed', 'old']]);
  const retained = mergeNetworkBodies(entries, previous, new Map([['res', 'grown']]), true);
  expect(Object.fromEntries(retained)).toEqual({ res: 'grown', req: 'request' });
  expect(mergeNetworkBodies(entries, new Map(), retained, false)).toEqual(retained);
  expect(mergeNetworkBodies([], retained, new Map(), true).size).toBe(0);
  expect(mergeNetworkBodies(entries, retained, new Map(), false).size).toBe(0);
});
