/* The local read server (backend/localapi, run inside the exe): when the server cannot be reached and nothing was kept for a
 * read, the PC's own copy of the business answers it with the backend's own route code. It only reads; every change still
 * goes through the outbox. It is used only once the copy has been downloaded completely, so a half-filled copy never
 * answers a screen. */

import { offlineStore } from "@/common/services/desktopBridge";
import { sessionClaims } from "./session";

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

/* The local answer to a GET (path after /api/v1, with its query string), or null when the copy cannot answer it. */
export async function localGet(pathWithQuery: string, branchHeader: string | null): Promise<string | null> {
  if (!bound || !offlineStore.available() || !(await copyIsComplete())) return null;
  const qi = pathWithQuery.indexOf("?");
  const path = qi < 0 ? pathWithQuery : pathWithQuery.slice(0, qi);
  const query = qi < 0 ? "" : pathWithQuery.slice(qi + 1);
  try {
    const res = await offlineStore.localApiGet(path, query, branchHeader ? { "X-Branch-Id": branchHeader } : {});
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
