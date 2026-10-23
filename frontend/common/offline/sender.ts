/* The sender. It takes the OLDEST sendable entry in the outbox and sends it:
 *   saved or duplicate  -> delete the line (the server has it)
 *   refused by the server -> review list (or dropped, if the screen is still waiting for the answer)
 *   anything else       -> keep the entry, stop, and let the next cron tick try again
 * When the outbox is empty after at least one line was sent, it does one pull. There is no health check:
 * the only signal is whether the real request got an answer. */

import { offlineStore } from "@/common/services/desktopBridge";
import { replayRequest } from "@/common/services/httpClient";
import { ENTRIES_SENT_EVENT, ENTRY_REFUSED_EVENT, isRefusal, isWatched, refuse } from "./live";
import { getLocal, removeLocal, upsertLocal } from "./localCopy";
import { pull } from "./pull";
import { sendToReview } from "./review";
import { warmReadCache } from "./warm";
import { uploadFileOnline } from "@/common/services/uploadService";
import { forgetRegistration } from "./device";
import { withUploadedPhotos } from "./photos";
import { ensureRegistered } from "./register";
import { rememberPledge, resolvePledgePath } from "./pledgeRef";
import type { EntityName, OutboxEntry } from "./types";

let running = false;
let again = false;

function parse(line: string): OutboxEntry | null {
  try {
    const e = JSON.parse(line) as OutboxEntry;
    return e && typeof e.id === "string" && typeof e.path === "string" && typeof e.method === "string" ? e : null;
  } catch {
    return null;
  }
}

/* A saved reply puts the server's number on the record the screens show (#7F3A becomes LN-00235). */
async function applyReply(entry: OutboxEntry, body: unknown): Promise<void> {
  const rec = ((body as { data?: unknown } | undefined)?.data ?? body) as Record<string, unknown> | undefined;
  const uuid = rec && typeof rec.uuid === "string" ? rec.uuid : entry.targets?.[0];
  if (!rec || !uuid) return;
  // a scheme made on this PC is now on the server: drop the pending copy, the server's own list has it
  if (entry.method === "POST" && entry.path === "/schemes" && getLocal("schemes", entry.id)) await removeLocal("schemes", entry.id);
  if (entry.method === "POST" && (entry.path === "/cash-sources" || entry.path === "/expense-categories" || entry.path === "/categories") && getLocal("categories", entry.id)) await removeLocal("categories", entry.id);
  for (const entity of ["loans", "customers"] as EntityName[]) {
    if (!getLocal(entity, uuid)) continue;
    const fields: Record<string, unknown> = {};
    for (const key of ["id", "loan_number", "loanNumber", "code"]) if (rec[key] !== undefined) fields[key] = rec[key];
    if (Object.keys(fields).length) await upsertLocal(entity, { uuid, ...fields });
  }
}

export async function waitingCount(): Promise<number> {
  return (await offlineStore.readAllOutbox()).length;
}

/* True when the server answered and the outbox is now empty. */
export async function drain(why: string): Promise<boolean> {
  if (running) {
    again = true; // an entry was added mid-send: go round once more when this run ends
    return false;
  }
  running = true;
  let sent = 0;
  let stopped = false;
  try {
    // a PC the server does not know cannot sign its entries; it registers first and, if it cannot yet, waits
    if ((await offlineStore.readOutbox()).length > 0 && !(await ensureRegistered())) {
      stopped = true;
    }
    while (!stopped) {
      const entry = (await offlineStore.readOutbox()).map(parse).find((e): e is OutboxEntry => e !== null);
      if (!entry) break;
      // photos picked while offline are uploaded now and swapped for their URLs; if that cannot be done yet, wait
      const body = await withUploadedPhotos(entry.body, uploadFileOnline);
      if (body === null) {
        stopped = true;
        break;
      }
      // a release or void of a pledge made on this PC addresses it by the entry that created it
      const path = await resolvePledgePath(entry.path);
      if (path === null) {
        const message = "The re-pledge this refers to was not saved by the server.";
        offlineStore.log("warn", `entry ${entry.id} ${entry.method} ${entry.path} refused: ${message}`);
        await sendToReview(entry, message);
        window.dispatchEvent(new CustomEvent(ENTRY_REFUSED_EVENT, { detail: { message: `${message} An admin can review it in Settings.` } }));
        continue;
      }
      const r = await replayRequest({
        method: entry.method,
        path,
        body,
        clientUuid: entry.id,
        occurredAt: entry.occurredAt,
      });
      if (r.outcome === "retry" && isRefusal(r.status, r.message)) {
        // The server read this save and said no, as it would online.
        const message = r.message || "The server did not accept this.";
        offlineStore.log("warn", `entry ${entry.id} ${entry.method} ${entry.path} refused: ${r.status} ${message}`);
        if (isWatched(entry.id)) {
          // someone is still at the screen: they get the message there, the same as an online save, so the entry
          // is dropped and the local copy goes back to what the server holds
          await offlineStore.deleteOutboxEntry(entry.id);
          await refuse(entry.id, { status: r.status, message });
        } else {
          // nobody is waiting for it: it goes to the admin's review list, still on this PC with the server's reason,
          // and the entries behind it are not held up (only later ones on the same record wait with it)
          await sendToReview(entry, message);
          window.dispatchEvent(new CustomEvent(ENTRY_REFUSED_EVENT, { detail: { message: `${message} An admin can review it in Settings.` } }));
        }
        continue;
      }
      if (r.outcome === "retry") {
        stopped = true;
        // an unknown or switched-off PC: forget the key so the next send registers again (a switched-off PC is refused there)
        if (r.status === 401 && /not registered|could not be verified/.test(r.message ?? "")) await forgetRegistration();
        // no answer is normal offline; an answer that was not "saved" is unexpected and goes to the log
        if (r.status !== 0) offlineStore.log("error", `entry ${entry.id} ${entry.method} ${entry.path}: ${r.status} ${r.message ?? ""}`);
        break;
      }
      if (entry.method === "POST" && /\/bank-pledge$/.test(entry.path)) await rememberPledge(entry.id, r.body);
      await applyReply(entry, r.body);
      await offlineStore.deleteOutboxEntry(entry.id);
      sent++;
    }
  } catch (e) {
    stopped = true;
    offlineStore.log("error", `send loop (${why}): ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    running = false;
  }
  if (again) {
    again = false;
    return drain("entry added while sending");
  }
  if (stopped) return false;
  // the list is empty: one pull brings this branch's changes (including other PCs') into the local copy
  const pulled = await pull(sent > 0 ? "outbox empty" : why);
  // what was just sent changes lists the PC keeps for offline use (a new scheme); fetch them again
  if (sent > 0) void warmReadCache(true);
  if (sent > 0) window.dispatchEvent(new Event(ENTRIES_SENT_EVENT));
  return sent > 0 || pulled;
}
