/* A save the server turns down (a rule, a permission) behaves as a failed save does online: the entry is
 * dropped, so it cannot hold up every entry behind it, and the local copy is put back. If the screen is still
 * waiting for the answer it shows the server's message; if the entry was sent later, from the queue, the
 * message is shown once on whatever screen is open (ENTRY_REFUSED_EVENT). */

export const ENTRY_REFUSED_EVENT = "app:entry-refused";

/* Fired after the sender has posted one or more entries and the local copy has caught up with the server, so a screen
 * that read its list a moment earlier (before the server had the entry) reads it again. */
export const ENTRIES_SENT_EVENT = "app:entries-sent";

export type Refusal = { status: number; message: string };

type Waiting = { undo: () => Promise<void> | void };

const waiting = new Map<string, Waiting>();
const refused = new Map<string, Refusal>();

export function watch(id: string, undo: () => Promise<void> | void): void {
  waiting.set(id, { undo });
}

export function unwatch(id: string): void {
  waiting.delete(id);
  refused.delete(id);
}

export function isWatched(id: string): boolean {
  return waiting.has(id);
}

/* Statuses that mean "the server read this and said no", as opposed to "try again". A 409 is a business refusal too
 * (already approved, cannot be edited), except the server's "still being processed", which is only a wait. */
export function isRefusal(status: number, message = ""): boolean {
  if (status === 409) return !/still being processed/i.test(message);
  return status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429;
}

export async function refuse(id: string, r: Refusal): Promise<void> {
  refused.set(id, r);
  const w = waiting.get(id);
  if (w) await w.undo();
}

export function refusalOf(id: string): Refusal | undefined {
  return refused.get(id);
}
