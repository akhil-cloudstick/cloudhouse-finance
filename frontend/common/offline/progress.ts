/* How far the offline copy has got, in one place: the profile ring, the Sync now button and the Settings bar all read it.
 * The loan pull and the table mirror report into it as they go.
 *
 * The first download is shown as a percentage: the loan pull counts for the first tenth, and the other tables share the
 * rest, one step per table. Once the copy has been complete, later syncs only show that something is running. */

export const SYNC_STATE_EVENT = "app:offline-sync-state";
export const PROGRESS_EVENT = "app:offline-progress";

type State = {
  pull: { running: boolean; pages: number; ready: boolean };
  mirror: { running: boolean; done: number; total: number; ready: boolean };
};

const state: State = {
  pull: { running: false, pages: 0, ready: false },
  mirror: { running: false, done: 0, total: 0, ready: false },
};

const PULL_SHARE = 0.1;

function emit() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PROGRESS_EVENT));
  window.dispatchEvent(new Event(SYNC_STATE_EVENT));
}

export function setPull(next: Partial<State["pull"]>) {
  Object.assign(state.pull, next);
  emit();
}

export function setMirror(next: Partial<State["mirror"]>) {
  Object.assign(state.mirror, next);
  emit();
}

/* True while the loan pull or the table download is running. */
export function syncBusy(): boolean {
  return state.pull.running || state.mirror.running;
}

export type DownloadProgress = {
  /* a sync is running */
  active: boolean;
  /* the offline copy has never been complete on this PC, so the percentage is meaningful */
  initial: boolean;
  /* 0 to 1 */
  fraction: number;
  /* the copy is complete and nothing is running */
  ready: boolean;
};

export function downloadProgress(): DownloadProgress {
  const { pull, mirror } = state;
  const active = pull.running || mirror.running;
  const complete = pull.ready && mirror.ready;
  let fraction: number;
  if (complete && !active) fraction = 1;
  else if (mirror.total > 0 && (mirror.running || pull.ready)) fraction = PULL_SHARE + (1 - PULL_SHARE) * Math.min(1, mirror.done / mirror.total);
  else fraction = Math.min(PULL_SHARE, pull.pages * 0.02);
  return { active, initial: !complete, fraction, ready: complete && !active };
}
