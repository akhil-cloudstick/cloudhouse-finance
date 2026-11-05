/* One pull of this branch's changes since the cursor, run when the outbox has just emptied (and by Refresh).
 * The server filters by branch, so a record from another branch never arrives. */

import { apiFetchEnveloped } from "@/common/services/httpClient";
import { offlineStore } from "@/common/services/desktopBridge";
import { listLocal, mergeLocal, replaceLocal } from "./localCopy";
import { employeeId } from "./session";
import type { OutboxEntry, PullPayload } from "./types";

const CURSOR_FILE = "cursor.json";

// Bumped when what a full download holds grows (v2: every closed loan, not just the last 90 days), so a PC that downloaded
// under the old rule does one full download again instead of only ever fetching changes.
const FULL_COPY_VERSION = 2;

async function readCursor(): Promise<string> {
  try {
    const text = await offlineStore.readFile(CURSOR_FILE);
    if (!text) return "";
    const c = JSON.parse(text) as { since?: string; full?: number };
    return (c.full ?? 1) >= FULL_COPY_VERSION ? (c.since ?? "") : "";
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
  // The cursor says how far the local copy has caught up. If the copy is empty (a file that could not be read, a store that
  // was recreated) while a cursor remains, an incremental pull would only ever bring new changes and the copy would stay
  // empty, so everything is downloaded again.
  let since = await readCursor();
  if (since && listLocal("loans").length === 0 && listLocal("customers").length === 0) {
    offlineStore.log("warn", `pull (${why}): local copy is empty but a cursor exists; downloading everything again`);
    since = "";
  }
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
  await offlineStore.writeFile(CURSOR_FILE, JSON.stringify({ since: payload.cursor, full: FULL_COPY_VERSION }));
  offlineStore.log("info", `pull (${why}): ${payload.loans.length} loans, ${payload.customers.length} customers`);
  return true;
}
