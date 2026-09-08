/** Full entry lists own body lifetimes; patches only replace changed bytes. */
export function mergeNetworkBodies<T>(
  entries: readonly { requestBodyPath?: string; responseBodyPath?: string }[],
  previous: ReadonlyMap<string, T>, updates: ReadonlyMap<string, T>, patch: boolean,
): Map<string, T> {
  const bodies = new Map<string, T>();
  for (const entry of entries) {
    for (const path of [entry.requestBodyPath, entry.responseBodyPath]) {
      if (!path) continue;
      const body = updates.get(path) ?? (patch ? previous.get(path) : undefined);
      if (body !== undefined) bodies.set(path, body);
    }
  }
  return bodies;
}
