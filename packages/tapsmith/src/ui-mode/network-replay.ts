import type { NetworkMessage } from './ui-protocol.js';
import { mergeNetworkBodies } from './network-bodies.js';
import { traceKey } from './trace-identity.js';

/** Keep one complete reconnect snapshot per file/project/test, merging live body patches. */
export class NetworkReplayBuffer {
  private snapshots = new Map<string, NetworkMessage>();
  constructor(private readonly capacity: number) {}

  add(message: NetworkMessage): void {
    const key = traceKey(message.projectName, message.testFullName, message.filePath);
    const previous = this.snapshots.get(key);
    if (!previous && this.snapshots.size >= this.capacity) return;
    this.snapshots.set(key, { ...message, bodyMode: undefined,
      bodies: Object.fromEntries(mergeNetworkBodies(message.entries,
        new Map(Object.entries(previous?.bodies ?? {})),
        new Map(Object.entries(message.bodies ?? {})), message.bodyMode === 'patch')),
    });
  }

  clear(): void { this.snapshots.clear(); }
  values(): IterableIterator<NetworkMessage> { return this.snapshots.values(); }
}
