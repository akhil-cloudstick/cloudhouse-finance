/* Whether offline mode is running. Kept apart from index.ts so the modules index.ts depends on can read it
 * without importing index.ts back. */

let ready = false;

export function offlineReady(): boolean {
  return ready;
}

export function setOfflineReady(on: boolean): void {
  ready = on;
}
