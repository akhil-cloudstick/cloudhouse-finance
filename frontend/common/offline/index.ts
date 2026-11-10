/* Offline mode for the desktop exe. Every Save is added to the outbox and the local copy together; the sender
 * sends the outbox oldest first, right after a Save and from a 10-minute cron. In a browser none of this runs
 * and the app behaves as before. */

import { lan, offlineStore } from "@/common/services/desktopBridge";
import { ensureLanKey } from "./lanKey";
import { currentDevice, forgetDevice, loadDevice } from "./device";
import { uuid7 } from "./ids";
import { installImageGuard } from "./imageCache";
import { loadAuctionStages } from "./auctionStages";
import { changeWithEntry, loadLocalCopy, saveWithEntry } from "./localCopy";
import { flushRememberedLogin } from "./loginCache";
import { offlineBusiness } from "./session";
import { askStorageChoice } from "./storageChoice";
import { setReadCacheEnabled } from "./readCache";
import { loadCopyStatus, pull } from "./pull";
import { loadMirrorStatus } from "./mirrorSync";
import { bindLocalApi, resetLocalApi } from "./localApi";
import { drain } from "./sender";
import { warmReadCache } from "./warm";
import { offlineReady, setOfflineReady, setSharedData, sharedData } from "./state";
import type { Actor, OutboxEntry } from "./types";

export { uuid7, refPath } from "./ids";
export { offlineReady } from "./state";
export { changeWithEntry, getLocal, listLocal, removeLocal, subscribeLocal, upsertLocal } from "./localCopy";
export type { Actor, EntityName, LocalRecord, OutboxEntry } from "./types";

// how often the sender and the pull run on their own (a save, coming back online and the manual button run at once)
const CRON_MS = 10 * 60_000;
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
		// the business key lets this PC join the main PC on the local network; it is asked for before the store opens,
		// because the store opens on the main PC's data when this PC is a counter
		await ensureLanKey();
		await offlineStore.open(business, DEVICE_FOLDER);
		setSharedData(lan.available() ? (await lan.dataMode()).shared : false);
		await loadDevice();
		await loadLocalCopy();
		await loadCopyStatus();
		await loadMirrorStatus();
		await loadAuctionStages();
		setOfflineReady(true);
		void bindLocalApi();
	} catch (e) {
		setOfflineReady(false);
		setSharedData(false);
		console.error("offline mode could not start", e);
		void offlineStore.log("error", `offline mode could not start: ${e instanceof Error ? e.message : String(e)}`);
		return;
	}
	watchLan();
	setReadCacheEnabled(true);
	installImageGuard();
	void flushRememberedLogin();
	offlineStore.log("info", `offline mode started for ${business} on ${deviceLabel()}`);
	void drain("start").then(() => warmReadCache());
	timer = setInterval(() => {
		void drain("cron");
		// refresh what is kept for offline use (changes other people made reach this PC's copy)
		void warmReadCache();
	}, CRON_MS);
	window.addEventListener("online", onOnline);
}

export function stopOffline(): void {
	if (timer) clearInterval(timer);
	timer = null;
	window.removeEventListener("online", onOnline);
	setReadCacheEnabled(false);
	forgetDevice();
	resetLocalApi();
	setOfflineReady(false);
	setSharedData(false);
}

/* Reacts to the local network: when the main PC choice changes the store is opened again on the right data, and on the main
 * PC a counter's save starts the sending to the server at once. Set up once; the handlers check what is running. */
let watching = false;
let reopening = false;

function watchLan(): void {
	if (watching || !lan.available()) return;
	watching = true;
	lan.onMode(() => void reopenIfNeeded());
	lan.onEntries(() => {
		if (offlineReady() && !sharedData()) void drain("a counter saved");
	});
}

async function reopenIfNeeded(): Promise<void> {
	if (reopening || !offlineReady()) return;
	reopening = true;
	try {
		const m = await lan.dataMode();
		if (!m.needRestart) return;
		offlineStore.log("info", `the main PC choice changed: opening the offline store again (${m.live.reason})`);
		stopOffline();
		await startOffline();
	} catch (e) {
		offlineStore.log("error", `could not reopen the offline store: ${e instanceof Error ? e.message : String(e)}`);
	} finally {
		reopening = false;
	}
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

/* The save every screen uses: the entry and the local change are committed together, the sender is started, and the
 * call returns AT ONCE. The screen already has the result (the local copy, marked Pending); the sender posts the entry
 * from the outbox in the background, the server's number or status replaces the local one when it answers, and a
 * refusal goes to the admin's review list with a pop-up. Nothing waits for the server, so a save never lags.
 * (The name is kept from when it waited a few seconds; `undoLocal` is no longer needed because a refused entry is
 * kept for review rather than rolled back.) */
export async function enqueueAndWait(
	entry: OutboxEntry,
	applyLocal: () => Promise<void> | void,
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	_undoLocal?: () => Promise<void> | void,
): Promise<"sent" | "pending"> {
	if (!offlineReady()) throw new Error("offline mode is not running");
	await saveWithEntry(JSON.stringify(entry), applyLocal);
	void drain("after save");
	return "pending";
}
