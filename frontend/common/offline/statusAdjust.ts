/* Decisions and movements made on this PC that the server has not been sent yet. The request lists and the packet
 * screens show the server's last answer, which cannot know about them, so each waiting entry is applied to that answer
 * in the same way the server will once it is sent. When it has been sent the server's own answer includes it and it is
 * no longer in the outbox, so nothing is applied twice.
 *
 *  - request decisions (verify, approve, reject, payment): the request is marked "syncPending" (the list shows
 *    "Sending") and a rejection shows as Rejected;
 *  - packet movements: the packet shows its new stage and locker, and the movement list gets the new row. */

import { offlineStore } from "@/common/services/desktopBridge";
import { getSelectedBranchId } from "@/common/services/branchSelection";
import { listLocal } from "./localCopy";
import { LOCKER_REF, localRequestId } from "./requestRef";
import type { OutboxEntry } from "./types";

type Env = { data?: unknown; [k: string]: unknown };

async function waiting(): Promise<OutboxEntry[]> {
	const found: OutboxEntry[] = [];
	for (const line of await offlineStore.readAllOutbox().catch(() => [] as string[])) {
		try {
			found.push(JSON.parse(line) as OutboxEntry);
		} catch {
			/* a line that cannot be read changes nothing */
		}
	}
	return found;
}

function parse(body: string): Env | null {
	try {
		return JSON.parse(body) as Env;
	} catch {
		return null;
	}
}

/* The rows of a list answer: a bare list, or a page of {items}. Returns a setter so the page keeps its shape. */
function rowsOf(env: Env): { rows: Record<string, unknown>[]; put: (rows: Record<string, unknown>[]) => void } | null {
	const d = env.data;
	if (Array.isArray(d)) return { rows: d as Record<string, unknown>[], put: (r) => { env.data = r; } };
	// The server (Go) writes an empty list as null, so a list with nothing in it has to count as an empty list: otherwise the
	// rows made on this PC are never added to it (the first release request made offline, say).
	if (d === null || d === undefined) {
		const empty: Record<string, unknown>[] = [];
		return { rows: empty, put: (r) => { env.data = r; } };
	}
	if (d && typeof d === "object") {
		const o = d as { items?: Record<string, unknown>[] | null };
		if (Array.isArray(o.items)) return { rows: o.items, put: (r) => { o.items = r; } };
		if (o.items === null || "items" in o) {
			o.items = [];
			return { rows: o.items, put: (r) => { o.items = r; } };
		}
	}
	return null;
}

/* GET /loans/requests...: rows with a decision waiting to be sent, and a row for each new extension or release request
 * waiting to be sent (narrowed by the same loan / type / status the screen asked for). */
export async function adjustRequests(path: string, body: string): Promise<string> {
	const env = parse(body);
	if (!env) return body;
	const list = rowsOf(env);
	if (!list) return body;
	const qs = new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?") + 1) : "");
	const marks = new Map<number, { rejected: boolean; view: Record<string, unknown> }>();
	const fresh: Record<string, unknown>[] = [];
	for (const e of await waiting()) {
		const m = /^\/loans\/requests\/(\d+|ref:[0-9a-f-]+)\/(approve|decide|verify|release-payment)$/i.exec(e.path);
		if (m) {
			// a request made on this PC is addressed by the entry that creates it, and listed under the local id made from it
			const id = m[1].startsWith("ref:") ? localRequestId(m[1].slice(4)) : Number(m[1]);
			const rejected = (e.body as { action?: string } | undefined)?.action === "Rejected";
			// each waiting decision is applied in the order it was made, so a payment then an approval ends as approved
			marks.set(id, { rejected: rejected || !!marks.get(id)?.rejected, view: { ...marks.get(id)?.view, ...e.view } });
			continue;
		}
		const n = /^\/loans\/uuid:([0-9a-f-]+)\/(extension|release)-request$/i.exec(e.path);
		if (!n || e.method !== "POST") continue;
		const loan = listLocal("loans").find((l) => l.uuid === n[1]) as Record<string, unknown> | undefined;
		if (!loan) continue;
		const type = n[2] === "extension" ? "Extension" : "Release";
		const b = (e.body ?? {}) as { months?: number; detail?: string; ornamentIds?: number[] };
		const wantLoan = qs.get("loanId") ?? qs.get("loan_id");
		if (wantLoan && Number(wantLoan) !== Number(loan.id)) continue;
		if (qs.get("type") && qs.get("type") !== type) continue;
		if (qs.get("status") && qs.get("status") !== "Pending") continue;
		fresh.push({
			id: localRequestId(e.id),
			loanId: loan.id,
			loan: { loanNumber: loan.loanNumber, customer: loan.customer, status: loan.status },
			type,
			status: "Pending",
			requestedBy: "Staff",
			detail: b.detail ?? "",
			requestedAt: e.occurredAt,
			requestedExtensionMonths: type === "Extension" ? b.months ?? null : null,
			isPartial: type === "Release" && !!b.ornamentIds?.length,
			ornamentSelections: (b.ornamentIds ?? []).map((ornamentId) => ({ ornamentId })),
			approvalStage: "",
			remarks: "",
			verificationNotes: "",
			customerSawGold: false,
			paymentRecorded: false,
			locked: false,
			charges: 0,
			chargesApplied: 0,
			settlementAmount: 0,
			recordedDiscount: 0,
			recordedPayment: 0,
			...e.view,
			syncPending: true,
		});
	}
	if (!marks.size && !fresh.length) return body;
	const wantStatus = qs.get("status");
	list.put([
		// decisions made on a request that was itself made on this PC are applied to its row too
		...fresh
			.map((r) => {
				const mark = marks.get(Number(r.id));
				return mark ? { ...r, ...mark.view, ...(mark.rejected ? { status: "Rejected" } : {}) } : r;
			})
			.filter((r) => !wantStatus || r.status === wantStatus),
		...list.rows
			.map((r) => {
				const mark = marks.get(Number(r.id));
				return mark ? { ...r, ...mark.view, syncPending: true, ...(mark.rejected ? { status: "Rejected" } : {}) } : r;
			})
			// a request this PC has decided no longer belongs in the list of pending ones
			.filter((r) => !wantStatus || r.status === wantStatus),
	]);
	return JSON.stringify(env);
}

/* A movement waiting to be sent (packetId, or the pending packet's local id) or, with loanId, the gold of that loan
 * being released in full (a waiting complete-release moves the loan's packet to Released). */
type Movement = { packetId: number; loanId?: number; toStatus: string; lockerId?: number; remarks?: string; at: string };

/* The packet of a loan made on this PC has no server id; a movement on it is addressed by the loan's entry instead. */
export function loanUuidOfPacket(packetId: number): string | undefined {
	return (listLocal("loans") as unknown as { uuid?: string }[]).find((l) => l.uuid && localRequestId(l.uuid) === packetId)?.uuid;
}

async function movements(): Promise<Movement[]> {
	const out: Movement[] = [];
	const loans = listLocal("loans") as unknown as { uuid?: string; id?: number }[];
	for (const e of await waiting()) {
		if (e.method !== "POST") continue;
		const rel = /^\/loans\/uuid:([0-9a-f-]+)\/complete-release$/i.exec(e.path);
		if (rel) {
			const loanId = Number(loans.find((l) => l.uuid === rel[1])?.id) || 0;
			if (loanId > 0) out.push({ packetId: 0, loanId, toStatus: "Released", remarks: "Gold released to customer", at: e.occurredAt });
			continue;
		}
		const m = /^\/packets\/(\d+|loan-ref:[0-9a-f-]+)\/movements$/i.exec(e.path);
		if (!m) continue;
		const b = (e.body ?? {}) as { toStatus?: string; lockerId?: number | string; remarks?: string };
		// a locker made on this PC is named by its creating entry; the lists show it under the matching local id
		const lockerId = typeof b.lockerId === "string" && b.lockerId.startsWith(LOCKER_REF) ? localRequestId(b.lockerId.slice(LOCKER_REF.length)) : (b.lockerId as number | undefined);
		const packetId = m[1].startsWith("loan-ref:") ? localRequestId(m[1].slice("loan-ref:".length)) : Number(m[1]);
		if (b.toStatus) out.push({ packetId, toStatus: b.toStatus, lockerId, remarks: b.remarks, at: e.occurredAt });
	}
	return out;
}

function moved(p: Record<string, unknown>, list: Movement[]): Record<string, unknown> {
	let next = p;
	for (const mv of list) {
		if (mv.loanId !== undefined ? Number(p.loanId) !== mv.loanId : Number(p.id) !== mv.packetId) continue;
		next = { ...next, status: mv.toStatus, currentLockerId: mv.lockerId ?? (mv.toStatus === "Locker Stored" ? next.currentLockerId ?? null : null) };
		// the gold has left custody: the packet page reads the loan as closed and offers no further moves
		if (mv.loanId !== undefined && next.loan && typeof next.loan === "object") next.loan = { ...(next.loan as object), status: "Closed" };
	}
	return next;
}

/* A loan made on this PC gets its packet from the server only once the loan is sent. Until then the packet is listed
 * from the loan itself, under a local (negative) id, with "PENDING-xxxxxxxx" as its number and as the loan's number
 * (the same key the Loans screens show; the packet screens print both as "Pending"). A movement made on it is
 * queued against the loan and sent once the server has made the packet. */
const pendingKey = (uuid: string) => "PENDING-" + uuid.replace(/-/g, "").slice(-8).toUpperCase();

/* `list` (the waiting movements) is applied so the packet shows its stage now; without it the stage it was created in. */
async function pendingPackets(list?: Movement[]): Promise<Record<string, unknown>[]> {
	const sent = await waiting();
	const picked = getSelectedBranchId();
	return (listLocal("loans") as unknown as Record<string, unknown>[])
		.filter((l) => typeof l.uuid === "string" && !(Number(l.id) > 0) && (!picked || l.branchId === picked))
		.map((l) => {
			const uuid = l.uuid as string;
			// a locker picked on the New Loan form is where the server puts the packet when it creates it
			const lockerId = Number((sent.find((e) => e.id === uuid && e.method === "POST" && e.path === "/loans")?.body as { lockerId?: number } | undefined)?.lockerId) || null;
			const at = (l.createdAt as string) ?? new Date().toISOString();
			const packet = {
				id: localRequestId(uuid),
				code: `PKT-${pendingKey(uuid)}`,
				loanId: 0,
				loan: { ...l, id: 0, loanNumber: pendingKey(uuid) },
				status: lockerId ? "Locker Stored" : "Packet Generated",
				currentLockerId: lockerId,
				syncPending: true,
				createdAt: at,
				updatedAt: at,
			};
			return list ? moved(packet, list) : packet;
		});
}

type PendingFilter = (p: Record<string, unknown>) => boolean;

/* The packets list's own filters (loan, branch, customer, status, locker, search), applied to the pending packets. */
function filterOf(qs: URLSearchParams): PendingFilter {
	const csv = (k: string) => (qs.get(k) ?? "").split(",").filter(Boolean);
	const branches = csv("branchId").map(Number);
	const customers = csv("customerId").map(Number);
	const statuses = csv("status");
	const lockerId = Number(qs.get("lockerId")) || 0;
	const q = (qs.get("q") ?? "").trim().toLowerCase();
	return (p) => {
		const loan = p.loan as { branchId?: number; customerId?: number; loanNumber?: string; customer?: { name?: string } };
		if (qs.get("loanId")) return false; // a pending loan has no server id to match
		if (branches.length && !branches.includes(Number(loan.branchId))) return false;
		if (customers.length && !customers.includes(Number(loan.customerId))) return false;
		if (statuses.length && !statuses.includes(p.status as string)) return false;
		if (lockerId && p.currentLockerId !== lockerId) return false;
		if (q && ![p.code, loan.loanNumber, loan.customer?.name].join(" ").toLowerCase().includes(q)) return false;
		return true;
	};
}

const ok = (data: unknown) => JSON.stringify({ success: true, data });

/* GET /packets..., /packets/ID, /packets/by-code/CODE: the packet shows where it has been moved to, and the packets of
 * loans made on this PC are added. `body` is null when the server's answer was never kept. */
export async function adjustPackets(path: string, body: string | null): Promise<string | null> {
	const list = await movements();
	const pending = await pendingPackets(list);
	const one = /\/packets\/(-\d+)(\?|$)/.exec(path)?.[1];
	const code = /\/packets\/by-code\/([^/?]+)/.exec(path)?.[1];
	if (one || code) {
		const wanted = code ? decodeURIComponent(code) : "";
		const hit = pending.find((p) => (one ? String(p.id) === one : p.code === wanted));
		if (hit) return ok(hit);
		if (one) return null;
	}
	const qs = new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?") + 1) : "");
	const env = body ? parse(body) : null;
	const isList = !one && !code && /\/packets(\?|$)/.test(path);
	if (!env && isList) {
		// never kept: only what this PC holds
		const mine = pending.filter(filterOf(qs));
		return mine.length ? ok(qs.has("limit") ? { items: mine, hasMore: false, total: mine.length } : mine) : null;
	}
	if (!env) return body;
	const rows = rowsOf(env);
	if (isList && rows) {
		// the pending ones lead the first page (a page after the first is the server's own)
		const first = !Number(qs.get("offset"));
		const extra = first ? pending.filter(filterOf(qs)) : [];
		const known = new Set(rows.rows.map((r) => r.code));
		const fresh = extra.filter((p) => !known.has(p.code));
		rows.put([...fresh, ...rows.rows.map((p) => moved(p, list))]);
		const page = env.data as { total?: number };
		if (!Array.isArray(env.data) && typeof page.total === "number") page.total += fresh.length;
		return JSON.stringify(env);
	}
	if (!list.length) return body;
	if (rows) rows.put(rows.rows.map((p) => moved(p, list)));
	else if (env.data && typeof env.data === "object" && !Array.isArray(env.data)) env.data = moved(env.data as Record<string, unknown>, list);
	else return body;
	return JSON.stringify(env);
}

/* GET /packets/ID/movements: a row for each movement waiting to be sent; a packet that is only on this PC shows the
 * one stage it was created in. */
export async function adjustMovements(path: string, body: string | null): Promise<string | null> {
	const id = Number(/\/packets\/(-?\d+)\/movements/.exec(path)?.[1]);
	let env: Env | null;
	if (id < 0) {
		const p = (await pendingPackets()).find((x) => x.id === id);
		if (!p) return null;
		const lockerId = p.currentLockerId as number | null;
		env = { success: true, data: [{ id: 0, packetId: id, fromStatus: "", toStatus: p.status, lockerId, actorEmployeeId: 0, remarks: lockerId ? "Locker assigned at packet creation" : "", createdAt: p.createdAt }] };
	} else {
		// a packet whose history was never kept shows only what this PC has done with it, so it can still be moved
		env = body ? parse(body) : { success: true, data: [] };
	}
	if (!env || !Array.isArray(env.data) || !id) return body;
	const mine = (await movements()).filter((m) => m.packetId === id);
	if (!mine.length) return id < 0 ? JSON.stringify(env) : body;
	let last = (env.data as { toStatus?: string }[]).at(-1)?.toStatus ?? "";
	const extra = mine.map((m) => {
		const row = { id: 0, packetId: id, fromStatus: last, toStatus: m.toStatus, lockerId: m.lockerId ?? null, actorEmployeeId: 0, remarks: m.remarks ?? "", createdAt: m.at };
		last = m.toStatus;
		return row;
	});
	env.data = [...(env.data as unknown[]), ...extra];
	return JSON.stringify(env);
}
