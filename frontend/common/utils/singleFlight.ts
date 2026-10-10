/* Synchronous re-entry guard for button handlers.
 *
 * A `disabled={busy}` button only turns off after React re-renders, so a fast
 * double click can fire the handler twice (two PDF exports, two submits).
 * This tracks in-flight work by key at module level, so the second call is
 * dropped immediately — no render needed. The key is released when the work
 * settles, success or failure. Returns undefined when a call was dropped. */
const inflight = new Set<string>();

export async function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
  if (inflight.has(key)) return undefined;
  inflight.add(key);
  try {
    return await fn();
  } finally {
    inflight.delete(key);
  }
}
