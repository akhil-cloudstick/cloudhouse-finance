/* An extension or release request made on this PC has no server id until it is sent, yet it can be verified, paid and
 * approved in the meantime. The lists show it under a local (negative) id, and those later entries address it as
 * ref:<id of the entry that creates it>; once that entry has been sent the server's request id is kept here, and the
 * sender swaps the ref for it just before the later entry goes. Same idea as pledgeRef.ts. */

import { offlineStore } from "@/common/services/desktopBridge";
import type { OutboxEntry } from "./types";

const FILE = "data/request_refs.json";
export const REQUEST_REF = /\/loans\/requests\/ref:([0-9a-f-]+)(\/|$)/i;
const CREATES_REQUEST = /^\/loans\/uuid:[0-9a-f-]+\/(release|extension)-request$/i;
/* A reminder made on this PC works the same way: listed under a local id, and a mark-done, edit or delete before it is
 * sent addresses it as /reminders/ref:<entry id>. */
const REMINDER_PATH_REF = /\/reminders\/ref:([0-9a-f-]+)(\/|$)/i;
/* An investment or a personal loan made on this PC and not sent yet is listed under a local (negative) id; whatever is done to it before
 * it is sent (add cash, withdraw, close, a payment...) addresses it as /investments/ref:<entry id>, and the sender swaps in the server's
 * id once the entry that created it has been sent. */
const RECORD_PATH_REF = /\/(?:investments|personal-loans)\/ref:([0-9a-f-]+)(\/|$)/i;

/* A role made on this PC and not sent yet: its permission matrix is saved against /employees/<id>/permissions/ref:<entry id>, and an
 * approval chain that names it carries "role-ref:<entry id>" in place of its id. (An employee names a role by its NAME, so needs no ref.) */
const ROLE_PATH_REF = /\/permissions\/ref:([0-9a-f-]+)(\/|\?|$)/i;
export const ROLE_REF = "role-ref:";

export function createsRole(entry: Pick<OutboxEntry, "method" | "path">): boolean {
	return entry.method === "POST" && entry.path === "/roles";
}

/* An employee made on this PC and not sent yet is listed under a local id; an edit or delete of it rewrites or takes back its entry. */
export function createsEmployee(entry: Pick<OutboxEntry, "method" | "path">): boolean {
	return entry.method === "POST" && entry.path === "/employees";
}

/* An expense made on this PC and not sent yet is listed under a local id; opening or editing it works on the waiting entry. */
export function createsExpense(entry: Pick<OutboxEntry, "method" | "path">): boolean {
	return entry.method === "POST" && entry.path === "/expenses";
}

/* The same for a cash-in, a debit or a self transfer keyed into the ledger (and an expense, which the ledger lists too). */
export function createsCashEntry(entry: Pick<OutboxEntry, "method" | "path">): boolean {
	return entry.method === "POST" && (entry.path === "/cash-movements" || entry.path === "/cash-movements/self-transfer" || entry.path === "/expenses");
}

export function createsInvestment(entry: Pick<OutboxEntry, "method" | "path">): boolean {
	return entry.method === "POST" && entry.path === "/investments";
}

export function createsPersonalLoan(entry: Pick<OutboxEntry, "method" | "path">): boolean {
	return entry.method === "POST" && entry.path === "/personal-loans";
}

const LOCAL_RECORD = /^\/(investments|personal-loans)\/(-\d+)(\/.*)?$/;

/* The path with a local id swapped for the entry that creates the record (or its server id once that entry was sent). A path that is
 * not about such a record, or whose creating entry is gone, comes back as it was. */
export async function refLocalRecordPath(path: string): Promise<string> {
	const [bare, query] = path.split("?");
	const m = LOCAL_RECORD.exec(bare);
	if (!m) return path;
	const found = await findLocalRequest(Number(m[2]), m[1] === "investments" ? createsInvestment : createsPersonalLoan);
	if (!found) return path;
	const seg = "entryId" in found ? `ref:${found.entryId}` : String(found.serverId);
	return `/${m[1]}/${seg}${m[3] ?? ""}${query ? `?${query}` : ""}`;
}

export function createsReminder(entry: Pick<OutboxEntry, "method" | "path">): boolean {
	return entry.method === "POST" && entry.path === "/reminders";
}

let cache: Record<string, number> | null = null;

async function load(): Promise<Record<string, number>> {
	if (cache) return cache;
	try {
		const text = await offlineStore.readFile(FILE);
		cache = text ? (JSON.parse(text) as Record<string, number>) : {};
	} catch {
		cache = {};
	}
	return cache;
}

/* A local id that is never a server id (those are positive) and is stable for the same entry. */
export function localRequestId(entryId: string): number {
	return -(parseInt(entryId.replace(/-/g, "").slice(-7), 16) + 1);
}

/* A locker made on this PC works the same way: it is listed under a local id, a packet checked into it carries
 * "locker-ref:<entry id>" as its locker, and an edit or delete addresses it as /lockers/ref:<entry id>. */
export const LOCKER_REF = "locker-ref:";
const LOCKER_PATH_REF = /\/lockers\/ref:([0-9a-f-]+)(\/|$)/i;

export function createsLocker(entry: Pick<OutboxEntry, "method" | "path">): boolean {
	return entry.method === "POST" && entry.path === "/lockers";
}

/* A loan made on this PC: the server's id for it is kept the same way, so the packet the server makes for it can be found. */
export function createsLoan(entry: Pick<OutboxEntry, "method" | "path">): boolean {
	return entry.method === "POST" && entry.path === "/loans";
}

/* The movement of a pending packet is addressed by the loan's creating entry: /packets/loan-ref:<entry id>/movements. */
export const PACKET_REF = /^\/packets\/loan-ref:([0-9a-f-]+)\/movements$/i;

export async function serverIdOf(entryId: string): Promise<number | undefined> {
	return (await load())[entryId];
}

export function createsRequest(entry: Pick<OutboxEntry, "method" | "path">): boolean {
	return entry.method === "POST" && CREATES_REQUEST.test(entry.path);
}

/* The reply to the entry that created the request carries the server's id for it. */
export async function rememberRequest(entryId: string, body: unknown): Promise<void> {
	const rec = ((body as { data?: unknown } | undefined)?.data ?? body) as { id?: number } | undefined;
	const id = Number(rec?.id) || 0;
	if (id <= 0) return;
	const map = await load();
	map[entryId] = id;
	await offlineStore.writeFile(FILE, JSON.stringify(map));
}

/* The entry's path with a ref swapped for the server's request id; null when that request never reached the server. */
export async function resolveRequestPath(path: string): Promise<string | null> {
	const m = REQUEST_REF.exec(path) ?? LOCKER_PATH_REF.exec(path) ?? REMINDER_PATH_REF.exec(path) ?? RECORD_PATH_REF.exec(path) ?? ROLE_PATH_REF.exec(path);
	if (!m) return path;
	const id = (await load())[m[1]];
	return id ? path.replace(`ref:${m[1]}`, String(id)) : null;
}

/* An investment plan made on this PC works the same way: it is listed under a local id, and an investment made with it
 * carries "plan-ref:<entry id>" as its plan until the sender swaps in the server's plan id. */
export const PLAN_REF = "plan-ref:";

export function createsPlan(entry: Pick<OutboxEntry, "method" | "path">): boolean {
	return entry.method === "POST" && entry.path === "/investment-plans";
}

export function findLocalPlan(localId: number): Promise<{ entryId: string } | { serverId: number } | null> {
	return findLocalRequest(localId, createsPlan);
}

/* The body with every plan ref swapped for the server's plan id; null when that plan never reached the server. */
export async function resolvePlanRefs(body: unknown): Promise<unknown | null> {
	if (typeof body === "string") {
		const prefix = [PLAN_REF, LOCKER_REF, ROLE_REF].find((p) => body.startsWith(p));
		if (!prefix) return body;
		const id = (await load())[body.slice(prefix.length)];
		return id ? id : null;
	}
	if (Array.isArray(body)) {
		const out: unknown[] = [];
		for (const v of body) {
			const r = await resolvePlanRefs(v);
			if (r === null) return null;
			out.push(r);
		}
		return out;
	}
	if (body && typeof body === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
			const r = await resolvePlanRefs(v);
			if (r === null && v !== null) return null;
			out[k] = r;
		}
		return out;
	}
	return body;
}

/* What a local request id points at: the waiting entry that creates it (so later entries can address it by ref), or the
 * server id once that entry has been sent. */
export async function findLocalRequest(localId: number, creates: (e: OutboxEntry) => boolean = createsRequest): Promise<{ entryId: string } | { serverId: number } | null> {
	for (const line of await offlineStore.readAllOutbox().catch(() => [] as string[])) {
		try {
			const e = JSON.parse(line) as OutboxEntry;
			if (creates(e) && localRequestId(e.id) === localId) return { entryId: e.id };
		} catch {
			/* a line that cannot be read creates nothing */
		}
	}
	const map = await load();
	for (const [entryId, serverId] of Object.entries(map)) if (localRequestId(entryId) === localId) return { serverId };
	return null;
}
