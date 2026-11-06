/* One helper for the actions that change a record the server already has (an edit, a delete, a status change).
 * On the desktop with offline mode running the request goes into the outbox and the call returns at once with
 * `whenQueued`; the sender posts it and the next pull brings the server's answer into the screens. In a browser, or
 * when offline mode is off, `online` runs exactly as before. */

import { enqueueAndWait, newEntry, offlineReady } from "./index";
import { currentActor } from "./actor";
import { refLocalRecordPath } from "./requestRef";
import { ApiError } from "@/common/services/httpClient";

export function canQueue(): boolean {
  return offlineReady();
}

export async function queueWrite<T>(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body: unknown,
  whenQueued: T,
  online: () => Promise<T>,
  applyLocal: () => Promise<void> | void = () => undefined,
): Promise<T> {
  if (!offlineReady()) return online();
  // an investment or personal loan made on this PC and not sent yet is addressed by the entry that creates it
  path = await refLocalRecordPath(path);
  // a record made on this PC and not yet on the server has a negative id; there is nothing on the server to change yet
  // (an ApiError, so the screen shows this sentence instead of its generic "could not save")
  if (/\/(-\d+|0)(\/|$|\?)/.test(path)) throw new ApiError("Not synced yet. Try again once it has synced.", 409);
  const entry = newEntry(method, path, body, currentActor());
  entry.targets = [entry.id];
  await enqueueAndWait(entry, applyLocal);
  return whenQueued;
}

/* For a function that already checked `canQueue()`: puts the request in the outbox and returns `whenQueued`. */
export function queueOnly<T>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body: unknown, whenQueued: T): Promise<T> {
  return queueWrite(method, path, body, whenQueued, () => Promise.reject(new Error("offline mode is not running")));
}

/* A dry-run / preview call cannot be answered without the server. */
export function previewNeedsServer(): never {
  throw new Error("This preview needs a connection to the server. Save the change instead, or try again when you are online.");
}
