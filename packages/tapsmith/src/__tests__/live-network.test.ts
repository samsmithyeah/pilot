import { afterEach, expect, it, vi } from 'vitest';
import { startLiveNetwork } from '../trace/live-network.js';
import type { NetworkEntry } from '../trace/types.js';

afterEach(() => { vi.useRealTimers(); });

it('waits for an outstanding snapshot on stop and suppresses its late publication', async () => {
  vi.useFakeTimers();
  let resolve!: (entries: NetworkEntry[]) => void;
  const read = vi.fn(() => new Promise<NetworkEntry[]>((r) => { resolve = r; }));
  const publish = vi.fn();
  const stop = startLiveNetwork(read, publish);
  await vi.advanceTimersByTimeAsync(2000);
  expect(read).toHaveBeenCalledTimes(1);
  let stopped = false;
  const stopping = stop().then(() => { stopped = true; });
  await Promise.resolve();
  expect(stopped).toBe(false);
  resolve([]);
  await stopping;
  await vi.advanceTimersByTimeAsync(2000);
  expect(publish).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalledTimes(1);
});

it('polls serially and stops publishing on abort', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const read = vi.fn(async () => []);
  const publish = vi.fn();
  const stop = startLiveNetwork(read, publish, controller.signal);
  await vi.advanceTimersByTimeAsync(1500);
  expect(publish).toHaveBeenCalledTimes(4);
  controller.abort();
  await vi.advanceTimersByTimeAsync(1500);
  expect(publish).toHaveBeenCalledTimes(4);
  await stop();
});
