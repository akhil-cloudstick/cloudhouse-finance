/* Taking back a record that was made on this PC and has not been sent yet (an investment, a personal loan). Nothing was ever recorded
 * on the server for it, so deleting it is just removing the entry that creates it, together with every entry made against it since
 * (add cash, withdraw, a payment...), which address it as ref:<entry id>. */

import { offlineStore } from "@/common/services/desktopBridge";
import { ApiError } from "@/common/services/httpClient";
import { changeWithEntry } from "./localCopy";
import { localRequestId } from "./requestRef";
import type { OutboxEntry } from "./types";

/* True when the record was found waiting and has been taken back; false when no entry creates it (it is on the server, or it was sent
 * in the meantime). */
export async function dropUnsentRecord(localId: number, creates: (e: OutboxEntry) => boolean): Promise<boolean> {
  const entries: OutboxEntry[] = [];
  for (const line of await offlineStore.readAllOutbox().catch(() => [] as string[])) {
    try {
      entries.push(JSON.parse(line) as OutboxEntry);
    } catch {
      /* a line that cannot be read is not ours */
    }
  }
  const creator = entries.find((e) => creates(e) && localRequestId(e.id) === localId);
  if (!creator) return false;
  const dependents = entries.filter((e) => e.id !== creator.id && e.path.includes(`/ref:${creator.id}`));
  try {
    for (const d of dependents) await changeWithEntry(d.id, "", () => undefined);
    await changeWithEntry(creator.id, "", () => undefined);
  } catch {
    throw new ApiError("It was sent while you were deleting it. Refresh, then delete it.", 409);
  }
  return true;
}

/* What is still waiting against an unsent record, oldest first: the entries addressed as ref:<entry id>/<action>. */
export async function waitingAgainst(creatorEntryId: string, base: "investments" | "personal-loans"): Promise<{ action: string; body: Record<string, unknown>; entry: OutboxEntry }[]> {
  const out: { action: string; body: Record<string, unknown>; entry: OutboxEntry }[] = [];
  const prefix = `/${base}/ref:${creatorEntryId}/`;
  for (const line of await offlineStore.readAllOutbox().catch(() => [] as string[])) {
    try {
      const e = JSON.parse(line) as OutboxEntry;
      if (e.method === "POST" && e.path.startsWith(prefix)) out.push({ action: e.path.slice(prefix.length).split("?")[0], body: (e.body ?? {}) as Record<string, unknown>, entry: e });
    } catch {
      /* a line that cannot be read adds nothing */
    }
  }
  return out;
}
