/* The local read server (backend/localapi, run inside the exe): when the server cannot be reached and nothing was kept for a
 * read, the PC's own copy of the business answers it with the backend's own route code. It only reads; every change still
 * goes through the outbox. It is used only once the copy has been downloaded completely, so a half-filled copy never
 * answers a screen. */

import { offlineStore } from "@/common/services/desktopBridge";
import { getLocal } from "./localCopy";
import { sessionClaims } from "./session";
import type { OutboxEntry } from "./types";

let bound = false;
let complete = false;

/* Tells the local server who is signed in. Called when offline mode starts. */
export async function bindLocalApi(): Promise<void> {
  bound = false;
  const claims = sessionClaims();
  if (!claims || !offlineStore.available()) return;
  try {
    await offlineStore.localApiBind(JSON.stringify(claims));
    bound = true;
  } catch (e) {
    offlineStore.log("warn", `local read server could not start: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function copyIsComplete(): Promise<boolean> {
  if (complete) return true;
  try {
    complete = (await offlineStore.mirrorState("mirror.ready")) === "1";
  } catch {
    complete = false;
  }
  return complete;
}

type Waiting = { method: string; path: string; body: string };

/* A loan this PC made is addressed by its uuid until the server numbers it; once the copy holds its number the server's own
 * route (which the local server can run) is used. */
function numbered(path: string): string {
  return path.replace(/\/loans\/uuid:([0-9a-f-]+)/i, (whole, uuid: string) => {
    const id = Number((getLocal("loans", uuid) as { id?: number } | undefined)?.id ?? 0);
    return id > 0 ? `/loans/${id}` : whole;
  });
}

async function waitingEntries(): Promise<(OutboxEntry & { sendPath: string })[]> {
  const out: (OutboxEntry & { sendPath: string })[] = [];
  for (const line of await offlineStore.readAllOutbox().catch(() => [] as string[])) {
    try {
      const e = JSON.parse(line) as OutboxEntry;
      out.push({ ...e, sendPath: numbered(e.path) });
    } catch {
      /* a line that cannot be read changes nothing */
    }
  }
  return out;
}

/* True when every change waiting on this loan can be run against the copy, so the local server's answer for the loan (with them
 * applied) is right. A change addressed to something the server has not numbered yet cannot be run. */
export async function loanChangesReplayable(uuid: string | undefined, loanId: number): Promise<boolean> {
  if (!uuid || !(loanId > 0) || !bound) return false;
  const mine = (await waitingEntries()).filter((e) => e.targets?.includes(uuid));
  return mine.every((e) => new RegExp(`/loans/${loanId}(/|$|\\?)`).test(e.sendPath) && !/(ref:|uuid:|-\d)/.test(e.sendPath));
}

/* Routes whose answer is a file (a PDF, a statement, an export, a bond, a receipt). The local server answers JSON only, so a file
 * would come back as damaged text; these are made on this PC by the document code instead (see documents.ts). */
const FILE_ROUTE = /(^|\/)(pdf|statement|statement-receipt|pledge-slip|release-agreement|partial-release-receipt|bond|export|download|receipt|esign)(\/|$|\?)|\/(bond|statement)\/pdf|preview-pdf/i;

/* The local answer to a GET (path after /api/v1, with its query string), or null when the copy cannot answer it. */
export async function localGet(pathWithQuery: string, branchHeader: string | null): Promise<string | null> {
  if (!bound || !offlineStore.available() || !(await copyIsComplete())) return null;
  if (FILE_ROUTE.test(pathWithQuery)) return null;
  const qi = pathWithQuery.indexOf("?");
  const path = qi < 0 ? pathWithQuery : pathWithQuery.slice(0, qi);
  const query = qi < 0 ? "" : pathWithQuery.slice(qi + 1);
  try {
    const headers: Record<string, string> = branchHeader ? { "X-Branch-Id": branchHeader } : {};
    const waiting: Waiting[] = (await waitingEntries()).map((e) => ({ method: e.method, path: e.sendPath, body: JSON.stringify(e.body ?? {}) }));
    // what is still waiting to be sent is applied first, by the server's own code, so the answer is what the server will show
    if (waiting.length) {
      const res = await offlineStore.localApiGetPending(path, query, headers, JSON.stringify(waiting));
      // a waiting change the copy could not run makes the answer untrustworthy: the caller falls back to what it showed before
      return res.status === 200 && !res.skipped ? res.body : null;
    }
    const res = await offlineStore.localApiGet(path, query, headers);
    return res.status === 200 ? res.body : null;
  } catch {
    return null;
  }
}

/* Forgets what was learned about the copy; called when offline mode stops (a sign-out, a moved folder). */
export function resetLocalApi(): void {
  bound = false;
  complete = false;
}
