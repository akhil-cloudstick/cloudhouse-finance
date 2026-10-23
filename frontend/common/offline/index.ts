/* Offline mode for the desktop exe. Every Save is added to the outbox and the local copy together; the sender
 * sends the outbox oldest first, right after a Save and from a 1-minute cron. In a browser none of this runs
 * and the app behaves as before. */

import { offlineStore } from "@/common/services/desktopBridge";
import { currentDevice, forgetDevice, loadDevice } from "./device";
import { uuid7 } from "./ids";
import { loadLocalCopy, saveWithEntry } from "./localCopy";
import { flushRememberedLogin } from "./loginCache";
import { offlineBusiness } from "./session";
import { askStorageChoice } from "./storageChoice";
import { setReadCacheEnabled } from "./readCache";
import { pull } from "./pull";
import { ApiError } from "@/common/services/httpClient";
import { refusalOf, unwatch, watch } from "./live";
import { drain } from "./sender";
import { warmReadCache } from "./warm";
import { offlineReady, setOfflineReady } from "./state";
import type { Actor, OutboxEntry } from "./types";

export { uuid7, refPath } from "./ids";
export { offlineReady } from "./state";
export { getLocal, listLocal, removeLocal, subscribeLocal, upsertLocal } from "./localCopy";
export type { Actor, EntityName, LocalRecord, OutboxEntry } from "./types";

const CRON_MS = 60_000;
const DEVICE_FOLDER = "pc"; // the folder is already per Windows user, so one folder is one PC

let timer: ReturnType<typeof setInterval> | null = null;

/* Who this PC is, as written on each entry: the id the server issued, or the machine id until it has. */
function deviceLabel(): string {
  const d = currentDevice();
  return d?.deviceId ? `dev_${d.deviceId}` : (d?.machineId ?? "");
}

/* Call once after sign-in. Opens this business's folder, loads the local copy, and starts the cron. */
let starting: Promise<void> | null = null;

export function startOffline(): Promise<void> {
  // asked again while the first-use question is still open: wait for that one run, never start a second
  starting ??= doStartOffline().finally(() => {
    starting = null;
  });
  return starting;
}

async function doStartOffline(): Promise<void> {
  if (!offlineStore.available() || offlineReady()) return;
  const business = offlineBusiness();
  try {
    // the first time on this PC the user decides where the offline data is kept
    if (!(await offlineStore.rootChosen())) await askStorageChoice();
    await offlineStore.open(business, DEVICE_FOLDER);
    await loadDevice();
    await loadLocalCopy();
    setOfflineReady(true);
  } catch (e) {
    setOfflineReady(false);
    console.error("offline mode could not start", e);
    return;
  }
  setReadCacheEnabled(true);
  void flushRememberedLogin();
  offlineStore.log("info", `offline mode started for ${business} on ${deviceLabel()}`);
  void drain("start").then(() => warmReadCache());
  let ticks = 0;
  timer = setInterval(() => {
    void drain("cron");
    // every 10 minutes, refresh what is kept for offline use
    if (++ticks % 10 === 0) void warmReadCache();
  }, CRON_MS);
  window.addEventListener("online", onOnline);
}

export function stopOffline(): void {
  if (timer) clearInterval(timer);
  timer = null;
  window.removeEventListener("online", onOnline);
  setReadCacheEnabled(false);
  forgetDevice();
  setOfflineReady(false);
}

function onOnline() {
  void drain("network back");
}

export function refreshNow(): Promise<boolean> {
  return pull("refresh");
}

export function newEntry(
  method: OutboxEntry["method"],
  path: string,
  body: unknown,
  actor: Actor,
  targets: string[] = [],
  id: string = uuid7(),
): OutboxEntry {
  return { id, method, path, body, occurredAt: new Date().toISOString(), actor, deviceId: deviceLabel(), targets };
}

/* Adds the entry to the outbox and applies the same change to the local copy in ONE database transaction (flushed
 * to disk before this returns), then starts the sender. The screen can show the result as soon as this resolves. */
export async function enqueue(entry: OutboxEntry, applyLocal: () => Promise<void> | void): Promise<void> {
  if (!offlineReady()) throw new Error("offline mode is not running");
  await saveWithEntry(JSON.stringify(entry), applyLocal);
  void drain("after save");
}

const SEND_WAIT_MS = 4000;

/* Like enqueue, then gives the sender a few seconds to reach the server. Returns "sent" when the server
 * answered and the outbox is empty (the caller can read the real record), or "pending" when it did not (the
 * entry stays queued and the caller shows the local copy). */
export async function enqueueAndWait(
  entry: OutboxEntry,
  applyLocal: () => Promise<void> | void,
  undoLocal: () => Promise<void> | void,
): Promise<"sent" | "pending"> {
  if (!offlineReady()) throw new Error("offline mode is not running");
  watch(entry.id, undoLocal);
  try {
    await saveWithEntry(JSON.stringify(entry), applyLocal);
    const settled = drain("after save");
    const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), SEND_WAIT_MS));
    const answered = await Promise.race([settled, timeout]);
    const no = refusalOf(entry.id);
    if (no) throw new ApiError(no.message, no.status);
    return answered ? "sent" : "pending";
  } finally {
    // past the wait, nobody is watching: a later refusal stays in the outbox and in the log
    setTimeout(() => unwatch(entry.id), 60_000);
  }
}
