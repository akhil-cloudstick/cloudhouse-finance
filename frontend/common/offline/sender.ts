/* The sender. It takes the OLDEST sendable entry in the outbox and sends it:
 *   saved or duplicate  -> delete the line (the server has it)
 *   refused by the server -> review list (or dropped, if the screen is still waiting for the answer)
 *   anything else       -> keep the entry, stop, and let the next cron tick try again
 * After the outbox has been tried, with or without a stuck entry, it does one pull. There is no health check:
 * the only signal is whether the real request got an answer. */

import { offlineStore } from "@/common/services/desktopBridge";
import { replayRequest } from "@/common/services/httpClient";
import { DATA_CHANGED_EVENT, ENTRIES_SENT_EVENT, ENTRY_REFUSED_EVENT, isRefusal, isWatched, refuse } from "./live";
import { getLocal, removeLocal, upsertLocal } from "./localCopy";
import { pull } from "./pull";
import { mirrorChanges, syncMirror } from "./mirrorSync";
import { SYNC_STATE_EVENT, syncBusy } from "./progress";
import { clearAuthExpired, markAuthExpired, setStuck } from "./syncProblem";
import { sharedData } from "./state";
import { sendToReview } from "./review";
import { warmReadCache } from "./warm";
import { uploadFileOnline } from "@/common/services/uploadService";
import { forgetRegistration } from "./device";
import { withUploadedPhotos } from "./photos";
import { ensureRegistered } from "./register";
import { rememberPledge, resolvePledgePath } from "./pledgeRef";
import { forgetSecret, hasSecretRef, resolveSecrets } from "./secrets";
import { createsInvestment, createsLoan, createsRole, createsLocker, createsPersonalLoan, createsPlan, createsReminder, PACKET_REF, serverIdOf, createsRequest, rememberRequest, resolvePlanRefs, resolveRequestPath } from "./requestRef";
import type { EntityName, OutboxEntry } from "./types";

let running = false;
let again = false;
let lastMirrorChanges = 0;

export { SYNC_STATE_EVENT } from "./progress";

/* True while the sender (cron, after a save, or the manual button) is sending, pulling or downloading the business tables. */
export function isSyncing(): boolean {
	return running || pulling || syncBusy();
}

// true while the pull that follows an empty outbox is running (the send loop has already ended by then)
let pulling = false;

function announce() {
	if (typeof window !== "undefined") window.dispatchEvent(new Event(SYNC_STATE_EVENT));
}

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
	// a locker made on this PC is now on the server: drop the pending copy, the server's own list has it
	// (so is a locker edit or delete shown from this PC's overlay)
	if (/^\/lockers(\/|$)/.test(entry.path) && getLocal("lockers", entry.id)) await removeLocal("lockers", entry.id);
	// a scheme edit or delete waiting on this PC is on the server now: the server's own list has it
	if (/^\/schemes\/\d+$/.test(entry.path) && getLocal("schemes", entry.id)) await removeLocal("schemes", entry.id);
	// an investor edit or delete waiting on this PC is on the server now: the server's own list has it
	const investorOp = /^\/investors\/(\d+)(\/hard-delete)?$/.exec(entry.path);
	if (investorOp && entry.method !== "POST" && getLocal("investors", "inv-" + investorOp[1])) await removeLocal("investors", "inv-" + investorOp[1]);
	const rec = ((body as { data?: unknown } | undefined)?.data ?? body) as Record<string, unknown> | undefined;
	const uuid = rec && typeof rec.uuid === "string" ? rec.uuid : entry.targets?.[0];
	if (!rec || !uuid) return;
	// a scheme made on this PC is now on the server: drop the pending copy, the server's own list has it
	if (entry.method === "POST" && entry.path === "/schemes" && getLocal("schemes", entry.id)) await removeLocal("schemes", entry.id);
	if (entry.method === "POST" && (entry.path === "/cash-sources" || entry.path === "/expense-categories" || entry.path === "/categories") && getLocal("categories", entry.id)) await removeLocal("categories", entry.id);
	for (const entity of ["loans", "customers", "investors"] as EntityName[]) {
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
	// a counter's entries are sent by the main PC (it holds them): sending them from here too would send each one twice
	if (sharedData()) return false;
	if (running) {
		// a sync is already running: one more round is queued behind it, so no trigger is lost
		again = true;
		return false;
	}
	running = true;
	announce();
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
			// and so does a decision on a request made on this PC (see requestRef.ts)
			const pledgePath = await resolvePledgePath(entry.path);
			const path = pledgePath === null ? null : await resolveRequestPath(pledgePath);
			if (path === null) {
				const message = pledgePath === null ? "The re-pledge this refers to was not saved by the server." : "The request this refers to was not saved by the server.";
				offlineStore.log("warn", `entry ${entry.id} ${entry.method} ${entry.path} refused: ${message}`);
				await sendToReview(entry, message);
				window.dispatchEvent(new CustomEvent(ENTRY_REFUSED_EVENT, { detail: { message: `${message} An admin can review it in Settings.` } }));
				continue;
			}
			// a movement on the packet of a loan made on this PC names the packet by the loan's entry: the server's packet is
			// looked up from the loan it made (the packet does not exist on the server until the loan does)
			let sendPath = path;
			const packetRef = PACKET_REF.exec(path);
			if (packetRef) {
				const loanId = await serverIdOf(packetRef[1]);
				let packetId = 0;
				if (loanId) {
					try {
						const { apiFetchEnveloped, quietly } = await import("@/common/services/httpClient");
						// asks the server itself (quietly): this PC's own copy cannot know the id the server just gave the packet
						const found = await quietly(() => apiFetchEnveloped<{ id: number }[] | { items?: { id: number }[] }>(`/packets?loanId=${loanId}`));
						packetId = (Array.isArray(found) ? found : found?.items ?? [])[0]?.id ?? 0;
					} catch {
						stopped = true; // no answer: try again with the next send
						break;
					}
				}
				if (!packetId) {
					const message = "The packet this refers to was not saved by the server.";
					offlineStore.log("warn", `entry ${entry.id} ${entry.method} ${entry.path} refused: ${message}`);
					await sendToReview(entry, message);
					window.dispatchEvent(new CustomEvent(ENTRY_REFUSED_EVENT, { detail: { message: `${message} An admin can review it in Settings.` } }));
					continue;
				}
				sendPath = `/packets/${packetId}/movements`;
			}
			// an investment made for an investor registered on this PC names them as uuid:<entry id>; the investor's entry was
			// sent before this one, so the server's id is in the local copy by now
			const customerRef = typeof (body as { customerId?: unknown } | null)?.customerId === "string" ? String((body as { customerId: string }).customerId) : "";
			let sendBody: unknown = body;
			if (customerRef.startsWith("uuid:")) {
				const known = (getLocal("customers", customerRef.slice(5)) ?? getLocal("investors", customerRef.slice(5))) as { id?: number } | undefined;
				if (known?.id && known.id > 0) {
					sendBody = { ...(body as object), customerId: known.id };
				} else {
					const message = "The customer this refers to was not saved by the server (see the customer's own entry in the review list).";
					offlineStore.log("warn", `entry ${entry.id} ${entry.method} ${entry.path} refused: ${message}`);
					await sendToReview(entry, message);
					window.dispatchEvent(new CustomEvent(ENTRY_REFUSED_EVENT, { detail: { message: `${message} An admin can review it in Settings.` } }));
					continue;
				}
			}
			// an investment made with a plan made on this PC names it by the entry that created the plan
			const resolvedBody = await resolvePlanRefs(sendBody);
			if (resolvedBody === null && sendBody !== null) {
				const message = JSON.stringify(sendBody).includes("role-ref:") ? "The role this refers to was not saved by the server." : "The plan this refers to was not saved by the server.";
				offlineStore.log("warn", `entry ${entry.id} ${entry.method} ${entry.path} refused: ${message}`);
				await sendToReview(entry, message);
				window.dispatchEvent(new CustomEvent(ENTRY_REFUSED_EVENT, { detail: { message: `${message} An admin can review it in Settings.` } }));
				continue;
			}
			// a password typed while this was waiting is kept sealed apart from the entry; it is put back in only for this send
			const sealedBody = await resolveSecrets(resolvedBody);
			if (sealedBody === null && resolvedBody !== null) {
				const message = "The password saved for this was lost. Make the change again.";
				offlineStore.log("warn", `entry ${entry.id} ${entry.method} ${entry.path} refused: ${message}`);
				await sendToReview(entry, message);
				window.dispatchEvent(new CustomEvent(ENTRY_REFUSED_EVENT, { detail: { message: `${message} An admin can review it in Settings.` } }));
				continue;
			}
			const r = await replayRequest({
				method: entry.method,
				path: sendPath,
				body: sealedBody,
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
					await offlineStore.mirrorDropTemp(entry.id).catch(() => undefined);
					if (hasSecretRef(entry.body)) await forgetSecret(entry.id);
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
					// the server no longer accepts this sign-in: keep working, ask to sign in again (see syncProblem.ts)
					else if (r.status === 401) markAuthExpired();
					// the server answered with an error: the change waits and is tried again; the banner says so
					else if (r.status !== 0) setStuck(true);
				// no answer is normal offline; an answer that was not "saved" is unexpected and goes to the log
				if (r.status !== 0) offlineStore.log("error", `entry ${entry.id} ${entry.method} ${entry.path}: ${r.status} ${r.message ?? ""}`);
				break;
			}
			if (entry.method === "POST" && /\/bank-pledge$/.test(entry.path)) await rememberPledge(entry.id, r.body);
			if (createsRequest(entry) || createsPlan(entry) || createsLocker(entry) || createsLoan(entry) || createsReminder(entry) || createsInvestment(entry) || createsPersonalLoan(entry) || createsRole(entry)) await rememberRequest(entry.id, r.body);
			await applyReply(entry, r.body);
			await offlineStore.deleteOutboxEntry(entry.id);
			// the rows this entry made under temporary ids give way to the server's own, which come down with the next pull
			await offlineStore.mirrorDropTemp(entry.id).catch(() => undefined);
			if (hasSecretRef(entry.body)) await forgetSecret(entry.id);
			sent++;
		}
	} catch (e) {
		stopped = true;
		offlineStore.log("error", `send loop (${why}): ${e instanceof Error ? e.message : String(e)}`);
	} finally {
		running = false;
		announce();
	}
	// every waiting entry went out: nothing is stuck and the server accepts this sign-in
	if (!stopped) {
		setStuck(false);
		clearAuthExpired();
	}
	if (again) {
		again = false;
		return drain("entry added while sending");
	}
	// one pull brings this branch's changes (including other PCs') into the local copy, whether or not an entry is stuck:
	// records with a waiting entry are kept as they are, and with no answer from the server the pull just returns
	pulling = true;
	announce();
	let pulled = false;
	try {
		pulled = await pull(sent > 0 ? "after send" : why);
	} finally {
		pulling = false;
		announce();
	}
	// what was just sent changes lists the PC keeps for offline use (a new scheme); fetch them again
	if (sent > 0) void warmReadCache(true);
	if (sent > 0) window.dispatchEvent(new Event(ENTRIES_SENT_EVENT));
	// the server answered: the business tables catch up too, and the sync is not finished until they have
	const mirrored = pulled ? await syncMirror(sent > 0 ? "after send" : why) : false;
	// screens read this PC's copy first, so they refresh once more now that the copy holds what the server sent back
	// (the first event above fires before the business tables have caught up)
	if (sent > 0 || mirrored) window.dispatchEvent(new Event(ENTRIES_SENT_EVENT));
	// only when rows really changed (not merely because the server answered): open pages may refresh (see AppShell)
	const seen = mirrorChanges();
	if (seen !== lastMirrorChanges) {
		lastMirrorChanges = seen;
		window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
	}
	if (stopped) return false;
	return sent > 0 || pulled || mirrored;
}
