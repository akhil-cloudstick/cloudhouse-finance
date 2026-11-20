/* One pull of this branch's changes since the cursor, run after the outbox has been tried (and by Refresh).
 * The server filters by branch, so a record from another branch never arrives. A download comes in batches:
 * each batch is merged into the local copy, and at checkpoints the copy and the position are saved together,
 * so a dropped connection resumes from the last checkpoint instead of starting again. */

import { apiFetchEnveloped } from "@/common/services/httpClient";
import { offlineStore } from "@/common/services/desktopBridge";
import { sharedData } from "./state";
import { listLocal, mergeLocal, saveLocal } from "./localCopy";
import { employeeId } from "./session";
import type { EntityName, OutboxEntry, PullPayload, SyncIds } from "./types";
import { setPull } from "./progress";

const CURSOR_FILE = "cursor.json";
const PAGE = 500;
const CHECKPOINT_PAGES = 10;
const IDS_CHECK_EVERY_MS = 60 * 60_000;

// Bumped when what a full download holds grows or was wrong, so a PC that downloaded under the old rule does one full
// download again instead of only ever fetching changes. v3: top-ups, requests, auctions and packets come with each loan.
// v4: the download is tied to the scope (which branches) it was made under.
const FULL_COPY_VERSION = 4;

type Progress = { since: string; loan_after: string; customer_after: string; start: string; loans: number; customers: number };
type CursorState = { since?: string; full?: number; ready?: boolean; idsCheckedAt?: number; progress?: Progress; scope?: string };

export const COPY_STATUS_EVENT = "app:offline-copy-status";

export type CopyStatus = { ready: boolean; downloading: boolean; loans: number; customers: number };

let status: CopyStatus = { ready: false, downloading: false, loans: 0, customers: 0 };

export function copyStatus(): CopyStatus {
	return status;
}

function announce(next: Partial<CopyStatus>) {
	status = { ...status, ...next };
	if (typeof window !== "undefined") window.dispatchEvent(new Event(COPY_STATUS_EVENT));
}

async function readState(): Promise<CursorState> {
	try {
		const text = await offlineStore.readFile(CURSOR_FILE);
		if (!text) return {};
		const c = JSON.parse(text) as CursorState;
		if ((c.full ?? 1) < FULL_COPY_VERSION) return {};
		return c;
	} catch {
		return {};
	}
}

async function writeState(state: CursorState): Promise<void> {
	await offlineStore.writeFile(CURSOR_FILE, JSON.stringify({ ...state, full: FULL_COPY_VERSION }));
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

/* Forgets how far the local copy has caught up, so the next pull downloads everything again.
 * Used after the server turned an entry down: whatever that entry changed locally is then put right. */
export async function resetCursor(): Promise<void> {
	try {
		await offlineStore.writeFile(CURSOR_FILE, "{}");
		announce({ ready: false });
		setPull({ ready: false });
	} catch {
		/* the next pull will just be incremental */
	}
}

/* A record hard-deleted on the server, or moved out of this branch, cannot be found by "changed since": its row is gone from
 * what this user can see. The server lists the UUIDs it can see now, and what the local copy holds beyond that is dropped,
 * except records with a waiting entry. */
async function dropGone(): Promise<boolean> {
	let ids: SyncIds;
	try {
		ids = await apiFetchEnveloped<SyncIds>(`/users/${employeeId()}/sync/ids`);
	} catch (e) {
		if ((e as { status?: number }).status !== 0) offlineStore.log("warn", `scope check failed: ${e instanceof Error ? e.message : String(e)}`);
		return false;
	}
	if (!ids || !Array.isArray(ids.loans) || !Array.isArray(ids.customers)) return false;
	const keep = await pending();
	const live: Record<string, Set<string>> = { loans: new Set(ids.loans), customers: new Set(ids.customers) };
	for (const entity of ["loans", "customers"] as EntityName[]) {
		const local = listLocal(entity);
		if (local.length > 0 && live[entity].size === 0) {
			offlineStore.log("warn", `scope check: the server listed no ${entity} while ${local.length} are held here; nothing removed`);
			continue;
		}
		const gone = local.map((r) => r.uuid).filter((u) => !live[entity].has(u) && !keep.has(u));
		if (gone.length) {
			await mergeLocal(entity, [], gone, keep);
			offlineStore.log("info", `scope check: ${gone.length} ${entity} no longer on the server or in this branch were removed`);
		}
	}
	return true;
}

let pullRunning = false;
let pullAgain = false;

/* Returns true when the server answered and the local copy was refreshed. A call made while a pull is running (a long
 * download takes minutes) is not lost: one more pull runs when that one ends. */
export async function pull(why: string): Promise<boolean> {
	if (sharedData()) return false; // the main PC downloads for every PC
	if (pullRunning) {
		pullAgain = true;
		return false;
	}
	pullRunning = true;
	setPull({ running: true, pages: 0 });
	try {
		return await runPull(why);
	} finally {
		pullRunning = false;
		setPull({ running: false });
		if (pullAgain) {
			pullAgain = false;
			void pull("queued");
		}
	}
}

async function runPull(why: string): Promise<boolean> {
	const id = employeeId();
	if (!id) return false;
	const state = await readState();
	let since = state.since ?? "";
	const progress = state.progress;
	// The cursor says how far the local copy has caught up. If the copy is empty (a file that could not be read, a store that
	// was recreated) while a cursor remains, an incremental pull would only ever bring new changes and the copy would stay
	// empty, so everything is downloaded again.
	if (!progress && since && listLocal("loans").length === 0 && listLocal("customers").length === 0) {
		offlineStore.log("warn", `pull (${why}): local copy is empty but a cursor exists; downloading everything again`);
		since = "";
	}
	if (progress) since = progress.since;
	let firstDownload = !since;
	if (firstDownload) announce({ downloading: true });
	// which branches the saved cursor was earned under; a different user or branch assignment sees a different set
	let scope = state.scope;

	let loans = progress?.loans ?? 0;
	let customers = progress?.customers ?? 0;
	let next = progress ?? { since, loan_after: "", customer_after: "", start: "", loans: 0, customers: 0 };
	let cursor = "";
	let pages = 0;
	try {
		for (;;) {
			const q = new URLSearchParams({ limit: String(PAGE) });
			if (since) q.set("since", since);
			if (next.loan_after) q.set("loan_after", next.loan_after);
			if (next.customer_after) q.set("customer_after", next.customer_after);
			if (next.start) q.set("start", next.start);
			let payload: PullPayload;
			try {
				payload = await apiFetchEnveloped<PullPayload>(`/users/${id}/sync/pull?${q.toString()}`);
			} catch (e) {
				// no answer is normal offline and leaves the copy as it is; anything else is worth a line in the log
				if ((e as { status?: number }).status !== 0) offlineStore.log("warn", `pull (${why}) failed: ${e instanceof Error ? e.message : String(e)}`);
				return false;
			}
			if (!payload || !Array.isArray(payload.loans) || !Array.isArray(payload.customers)) {
				offlineStore.log("warn", `pull (${why}) returned an unreadable body`);
				return false;
			}
			if (payload.scope && payload.scope !== scope) {
				const hadCursor = !!since;
				scope = payload.scope;
				if (hadCursor) {
					// What changed since the last pull is not enough for someone who sees different branches: this scope is downloaded from
					// the start (merged into what is held; what is no longer visible is dropped by the check at the end).
					offlineStore.log("info", `pull (${why}): the view changed to ${scope}; downloading it from the start`);
					since = "";
					next = { since: "", loan_after: "", customer_after: "", start: "", loans: 0, customers: 0 };
					loans = 0;
					customers = 0;
					pages = 0;
					firstDownload = true;
					announce({ downloading: true, ready: false });
					setPull({ ready: false, pages: 0 });
					continue;
				}
			}
			const keep = await pending();
			await mergeLocal("loans", payload.loans, payload.deleted.loans, keep, false);
			await mergeLocal("customers", payload.customers, payload.deleted.customers, keep, false);
			loans += payload.loans.length;
			customers += payload.customers.length;
			pages++;
			setPull({ pages });
			cursor = payload.cursor;
			const more = payload.has_more === true && !!payload.next;
			if (more) {
				next = { since, loan_after: payload.next!.loan_after, customer_after: payload.next!.customer_after, start: payload.next!.start, loans, customers };
				if (firstDownload) announce({ loans, customers });
				if (pages % CHECKPOINT_PAGES === 0) {
					// the copy is saved before the position, so a crash in between only repeats pages (rows are matched by UUID)
					await saveLocal("loans");
					await saveLocal("customers");
					await writeState({ ...state, since: state.since, ready: state.ready, progress: next, scope });
				}
				continue;
			}
			break;
		}
		await saveLocal("loans");
		await saveLocal("customers");
		let idsCheckedAt = state.idsCheckedAt ?? 0;
		if (firstDownload || Date.now() - idsCheckedAt > IDS_CHECK_EVERY_MS) {
			if (await dropGone()) idsCheckedAt = Date.now();
		}
		await writeState({ since: cursor, ready: true, idsCheckedAt, scope });
		offlineStore.log("info", `pull (${why}): ${loans} loans, ${customers} customers`);
		announce({ ready: true, loans: listLocal("loans").length, customers: listLocal("customers").length });
		setPull({ ready: true });
		return true;
	} finally {
		announce({ downloading: false });
	}
}

/* Called once the store is open: tells the screens whether this PC already holds a complete copy. */
export async function loadCopyStatus(): Promise<void> {
	const state = await readState();
	const ready = state.ready === true && !state.progress;
	announce({ ready, loans: listLocal("loans").length, customers: listLocal("customers").length });
	setPull({ ready });
}
