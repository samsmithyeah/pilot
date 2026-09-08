import { expect, it } from 'vitest';
import { NetworkReplayBuffer } from '../ui-mode/network-replay.js';
import { createNetworkBodyEncoder } from '../ui-mode/encode-bodies.js';
import { traceKey, parseTraceKey, TraceIdentityRegistry } from '../ui-mode/trace-identity.js';
import type { NetworkEntry } from '../trace/types.js';
import type { NetworkMessage } from '../ui-mode/ui-protocol.js';

it('keeps interleaved same-name file captures separate, including bodyless patches and replay', () => {
  const buffer = new NetworkReplayBuffer(2);
  const first = createNetworkBodyEncoder();
  const second = createNetworkBodyEncoder();
  const a = { index: 0, url: 'http://test/a', responseBody: Buffer.from('file A') } as NetworkEntry;
  const b = { index: 0, url: 'http://test/b', responseBody: Buffer.from('file B') } as NetworkEntry;
  const publish = (filePath: string, encoder: ReturnType<typeof createNetworkBodyEncoder>, entries: NetworkEntry[]) => {
    for (const chunk of encoder(entries)) buffer.add({ type: 'network', projectName: 'android', testFullName: 'smoke', filePath, bodyMode: 'patch', ...chunk });
  };
  publish('/a.test.ts', first, []);
  publish('/a.test.ts', first, [a]);
  publish('/b.test.ts', second, []);
  publish('/b.test.ts', second, [b]);
  publish('/a.test.ts', first, [a]);
  const replay = [...buffer.values()];
  expect(replay.map((msg) => [msg.filePath, msg.bodyMode, Buffer.from(msg.bodies!['network/res-0.bin'], 'base64').toString()]))
    .toEqual([['/a.test.ts', undefined, 'file A'], ['/b.test.ts', undefined, 'file B']]);
  // Updating an existing key still works at capacity. A retry clears just A.
  publish('/a.test.ts', first, []);
  expect([...buffer.values()][0].bodies).toEqual({});
  expect([...buffer.values()][1]).toEqual(replay[1]);
  publish('/c.test.ts', first, [a]);
  expect([...buffer.values()]).toHaveLength(2);
  buffer.clear();
  expect([...buffer.values()]).toEqual([]);
});

it('isolates projects and does not retain old bytes from a full snapshot', () => {
  const buffer = new NetworkReplayBuffer(10);
  const message: NetworkMessage = { type: 'network', filePath: '/a.ts', testFullName: 'smoke', entries: [{ index: 0, responseBodyPath: 'res' } as NetworkEntry], bodies: { res: 'old' } };
  buffer.add({ ...message, projectName: 'android' });
  buffer.add({ ...message, projectName: 'ios' });
  buffer.add({ ...message, projectName: 'android', bodies: {} });
  expect([...buffer.values()].map((m) => m.bodies)).toEqual([{}, { res: 'old' }]);
});

it('uses complete identities and refuses ambiguous legacy messages', () => {
  const registry = new TraceIdentityRegistry();
  const a = registry.register('android', 'smoke', '/a.ts');
  expect(registry.resolve('android', 'smoke')).toBe(a);
  const b = registry.register('android', 'smoke', '/b.ts');
  expect(registry.resolve('android', 'smoke')).toBeUndefined();
  expect(registry.resolve('android', 'smoke', '/a.ts')).toBe(a);
  expect(registry.resolve('android', 'smoke', '/b.ts')).toBe(b);
  expect(registry.resolve('ios', 'smoke')).toBeUndefined();
  expect(traceKey('p', 'b::c', '/a')).not.toBe(traceKey('p', 'c', '/a::b'));
  expect(parseTraceKey(a)).toEqual({ projectName: 'android', filePath: '/a.ts' });
});
