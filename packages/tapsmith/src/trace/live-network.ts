import type { NetworkEntry } from './types.js';

/** Serial, non-destructive polling. stop() suppresses late publications and
 * awaits the outstanding read before the runner drains/finalizes the trace. */
export function startLiveNetwork(
  read: () => Promise<NetworkEntry[]>,
  publish: (entries: NetworkEntry[]) => void,
  signal?: AbortSignal,
): () => Promise<void> {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void>;
  const tick = async (): Promise<void> => {
    try {
      const entries = await read();
      if (!stopped && !signal?.aborted) publish(entries);
    } catch (err) {
      if (!stopped && !signal?.aborted) {
        console.warn(`[tapsmith] Failed to publish live network capture: ${err instanceof Error ? err.message : err}`);
      }
    } finally {
      if (!stopped && !signal?.aborted) timer = setTimeout(() => { pending = tick(); }, 500);
    }
  };
  pending = tick();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await pending;
  };
}
