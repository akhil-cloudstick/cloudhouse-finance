/* One pull of this branch's changes since the cursor, run when the outbox has just emptied (and by Refresh).
 * The server filters by branch, so a record from another branch never arrives. */

import { apiFetchEnveloped } from "@/common/services/httpClient";
import { offlineStore } from "@/common/services/desktopBridge";
import { mergeLocal, replaceLocal } from "./localCopy";
import { employeeId } from "./session";
import type { OutboxEntry, PullPayload } from "./types";

const CURSOR_FILE = "cursor.json";

async function readCursor(): Promise<string> {
  try {
    const text = await offlineStore.readFile(CURSOR_FILE);
    return text ? ((JSON.parse(text) as { since?: string }).since ?? "") : "";
  } catch {
    return "";
  }
}

/* UUIDs of records that still have a waiting entry (including one in review): a pull must not overwrite those. */
async function pending(): Promise<Set<string>> {
  const keep = new Set<string>();
  for (const line of await offlineStore.readAllOutbox()) {
    try {
      for (const t of (JSON.parse(line) as OutboxEntry).targets ?? []) keep.add(t);
    } catch {
      /* a line the sender cannot read has no targets */
    }
  }
  return keep;
}

/* Forgets how far the local copy has caught up, so the next pull downloads everything and replaces the copy.
 * Used after the server turned an entry down: whatever that entry changed locally is then put right. */
export async function resetCursor(): Promise<void> {
  try {
    await offlineStore.writeFile(CURSOR_FILE, "{}");
  } catch {
    /* the next pull will just be incremental */
  }
}

/* Returns true when the server answered and the local copy was refreshed. */
export async function pull(why: string): Promise<boolean> {
  const id = employeeId();
  if (!id) return false;
  const since = await readCursor();
  let payload: PullPayload;
  try {
    payload = await apiFetchEnveloped<PullPayload>(`/users/${id}/sync/pull${since ? `?since=${encodeURIComponent(since)}` : ""}`);
  } catch (e) {
    // no answer is normal offline and leaves the copy as it is; anything else is worth a line in the log
    if ((e as { status?: number }).status !== 0) offlineStore.log("warn", `pull (${why}) failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
  if (!payload || !Array.isArray(payload.loans) || !Array.isArray(payload.customers)) {
    offlineStore.log("warn", `pull (${why}) returned an unreadable body`);
    return false;
  }
  const keep = await pending();
  if (!since) {
    await replaceLocal("loans", payload.loans, keep);
    await replaceLocal("customers", payload.customers, keep);
  } else {
    await mergeLocal("loans", payload.loans, payload.deleted.loans, keep);
    await mergeLocal("customers", payload.customers, payload.deleted.customers, keep);
  }
  await offlineStore.writeFile(CURSOR_FILE, JSON.stringify({ since: payload.cursor }));
  offlineStore.log("info", `pull (${why}): ${payload.loans.length} loans, ${payload.customers.length} customers`);
  return true;
}
