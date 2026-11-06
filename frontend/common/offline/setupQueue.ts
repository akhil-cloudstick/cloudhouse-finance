/* Helpers for the setup writes (banks, branches): changing the entry that creates a record which has not been sent yet. */

import { ApiError } from "@/common/services/httpClient";
import { changeWithEntry } from "./localCopy";
import { localRequestId } from "./requestRef";
import { waitingEntries } from "./setupAdjust";
import type { OutboxEntry } from "./types";

export const NOT_SYNCED = "Not synced yet. Try again once it has synced.";

/* Rewrites the body of the waiting entry that creates the record shown under `localId`, so an edit of an unsent record is just a
 * better "create". Refused (409) when no such entry waits any more (it has been sent: the server's own copy is edited once it syncs). */
export async function rewriteUnsent(localId: number, creates: (e: OutboxEntry) => boolean, patch: (body: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  const creator = (await waitingEntries()).find((e) => creates(e) && localRequestId(e.id) === localId);
  if (!creator) throw new ApiError(NOT_SYNCED, 409);
  const next: OutboxEntry = { ...creator, body: patch((creator.body ?? {}) as Record<string, unknown>) };
  try {
    await changeWithEntry(creator.id, JSON.stringify(next), () => undefined);
  } catch {
    throw new ApiError("It was sent while you were saving it. Refresh, then edit it.", 409);
  }
}
