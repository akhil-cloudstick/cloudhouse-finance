/* Setup records changed on this PC and not sent yet: banks, branches and the business profile. The screens show the server's last
 * answer; the entries still waiting in the outbox are applied on top of it, in the shape the server will use, so nothing else is stored.
 *
 * - A bank / branch made here is listed under a local (negative) id, but ONLY in the management lists (asked for with `mgmt=1`);
 *   the pickers other screens use never see it, so a negative id can never be sent inside another entry.
 * - A waiting edit is merged into the row, a waiting delete removes the bank (or, for a branch, marks it inactive as the server does).
 * - Once an entry is sent it leaves the outbox and the server's own answer includes it, so nothing is shown twice. */

import { offlineStore } from "@/common/services/desktopBridge";
import { localRequestId } from "./requestRef";
import type { OutboxEntry } from "./types";

export type Row = Record<string, unknown>;
export type Envelope = { success?: boolean; data?: unknown; [k: string]: unknown };
export type Recall = (path: string, view: string) => Promise<string | null>;

const BANK = /^(?:\/users\/\d+)?\/banks(?:\/(-?\d+))?$/;
const BRANCH = /^(?:\/users\/\d+)?\/branches(?:\/(-?\d+))?$/;
const PROFILE = /^(?:\/users\/\d+)?\/business-profile$/;

export const createsBank = (e: Pick<OutboxEntry, "method" | "path">) => e.method === "POST" && BANK.test(e.path.split("?")[0]) && !/\/banks\/-?\d+/.test(e.path);
export const createsBranch = (e: Pick<OutboxEntry, "method" | "path">) => e.method === "POST" && /^(?:\/users\/\d+)?\/branches$/.test(e.path.split("?")[0]);

export async function waitingEntries(): Promise<OutboxEntry[]> {
	const out: OutboxEntry[] = [];
	for (const line of await offlineStore.readAllOutbox().catch(() => [] as string[])) {
		try {
			out.push(JSON.parse(line) as OutboxEntry);
		} catch {
			/* a line that cannot be read changes nothing */
		}
	}
	return out;
}

export const bare = (path: string) => path.split("?")[0];
export const queryOf = (path: string) => new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?") + 1) : "");
export const num = (v: unknown) => Number(v) || 0;

/* The array of rows inside a list answer (a bare array, or a page holder with items). */
export function holderOf(env: Envelope): { rows: Row[]; put: (rows: Row[], extra: number) => Envelope } | null {
	const d = env.data;
	if (Array.isArray(d)) return { rows: d as Row[], put: (rows) => ({ ...env, data: rows }) };
	if (d && typeof d === "object" && Array.isArray((d as { items?: unknown }).items)) {
		const h = d as { items: Row[]; total?: number };
		return { rows: h.items, put: (rows, extra) => ({ ...env, data: { ...h, items: rows, ...(typeof h.total === "number" ? { total: Math.max(0, h.total + extra) } : {}) } }) };
	}
	return null;
}

export function parse(body: string): Envelope | null {
	try {
		return JSON.parse(body) as Envelope;
	} catch {
		return null;
	}
}

/* ---- banks ---- */

type BankBody = { name?: string; branchId?: number; branch?: string; ifsc?: string; accountNo?: string; phone?: string };

function applyBankEdit(row: Row, id: number, entries: OutboxEntry[], branchName: (id: number) => string): Row | null {
	let next = row;
	for (const e of entries) {
		const m = BANK.exec(bare(e.path));
		if (!m || m[1] === undefined || Number(m[1]) !== id) continue;
		if (e.method === "DELETE") return null;
		if (e.method !== "PUT" && e.method !== "PATCH") continue;
		const b = (e.body ?? {}) as BankBody;
		next = {
			...next,
			...(b.name !== undefined ? { name: String(b.name).trim() } : {}),
			...(b.branchId ? { branchId: b.branchId, branchName: branchName(b.branchId) || next.branchName } : {}),
			...(b.branch !== undefined ? { branch: String(b.branch).trim() } : {}),
			...(b.ifsc !== undefined ? { ifsc: String(b.ifsc).trim() } : {}),
			...(b.accountNo !== undefined ? { accountNo: String(b.accountNo).trim() } : {}),
			...(b.phone !== undefined ? { phone: String(b.phone).trim() } : {}),
		};
	}
	return next;
}

function bankFromCreate(e: OutboxEntry, branchName: (id: number) => string): Row {
	const b = (e.body ?? {}) as BankBody;
	return {
		id: localRequestId(e.id),
		name: String(b.name ?? "").trim(),
		branchId: num(b.branchId),
		branchName: branchName(num(b.branchId)),
		branch: String(b.branch ?? "").trim(),
		ifsc: String(b.ifsc ?? "").trim(),
		accountNo: String(b.accountNo ?? "").trim(),
		phone: String(b.phone ?? "").trim(),
		balance: 0,
		activePledgeCount: 0,
		activePledgeAmount: 0,
		createdAt: e.occurredAt,
		updatedAt: e.occurredAt,
	};
}

async function branchNames(recall: Recall, view: string, entries: OutboxEntry[]): Promise<(id: number) => string> {
	const names = new Map<number, string>();
	const body = await recall("/branches", view).catch(() => null);
	const env = body ? parse(body) : null;
	for (const r of (env && holderOf(env)?.rows) || []) names.set(num(r.id), String(r.name ?? ""));
	for (const e of entries) if (createsBranch(e)) names.set(localRequestId(e.id), String(((e.body ?? {}) as { name?: string }).name ?? ""));
	return (id) => names.get(id) ?? "";
}

function matchesQuery(text: string, words: string[]) {
	const t = text.toLowerCase();
	return words.every((w) => t.includes(w));
}

async function adjustBanks(path: string, cached: string | null, entries: OutboxEntry[], recall: Recall, view: string): Promise<string | null> {
	const m = BANK.exec(bare(path));
	if (!m) return cached;
	const creates = entries.filter(createsBank);
	const names = await branchNames(recall, view, entries);
	// one bank
	if (m[1] !== undefined) {
		const id = Number(m[1]);
		if (id < 0) {
			const e = creates.find((c) => localRequestId(c.id) === id);
			if (!e) return cached;
			const row = applyBankEdit(bankFromCreate(e, names), id, entries, names);
			return row ? JSON.stringify({ success: true, data: row }) : cached;
		}
		const env = cached ? parse(cached) : null;
		if (!env || !env.data || typeof env.data !== "object") return cached;
		const row = applyBankEdit(env.data as Row, id, entries, names);
		return row ? JSON.stringify({ ...env, data: row }) : cached;
	}
	// the list
	const edits = entries.some((e) => (e.method === "PUT" || e.method === "PATCH" || e.method === "DELETE") && BANK.test(bare(e.path)));
	const q = queryOf(path);
	const mgmt = q.get("mgmt") === "1";
	const pending = mgmt ? creates : [];
	if (!edits && !pending.length) return cached;
	let env = cached ? parse(cached) : null;
	if (!env) {
		if (!pending.length) return cached;
		env = { success: true, data: q.get("limit") ? { items: [], hasMore: false, total: 0, limit: Number(q.get("limit")), offset: Number(q.get("offset") ?? 0) } : [] };
	}
	const h = holderOf(env);
	if (!h) return cached;
	let removed = 0;
	const rows: Row[] = [];
	for (const r of h.rows) {
		const next = applyBankEdit(r, num(r.id), entries, names);
		if (next) rows.push(next);
		else removed += 1;
	}
	const words = (q.get("search") || q.get("q") || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
	const branchIds = (q.get("branchId") || "").split(",").map((s) => s.trim()).filter(Boolean);
	const added = pending
		.map((e) => bankFromCreate(e, names))
		.filter((r) => !branchIds.length || branchIds.includes(String(r.branchId)))
		.filter((r) => matchesQuery(`${r.name} ${r.branch} ${r.accountNo} ${r.ifsc} ${r.phone} ${r.branchName}`, words))
		.map((r) => applyBankEdit(r, r.id as number, entries, names))
		.filter((r): r is Row => r !== null);
	// an added row belongs on the first page only
	const first = !(num(q.get("offset")) > 0);
	const all = first ? [...rows, ...added] : rows;
	return JSON.stringify(h.put(all, added.length - removed));
}

/* ---- branches ---- */

type BranchBody = { name?: string; code?: string; address?: string; phone?: string; isActive?: boolean };

function applyBranchEdit(row: Row, id: number, entries: OutboxEntry[]): Row {
	let next = row;
	for (const e of entries) {
		const m = BRANCH.exec(bare(e.path));
		if (!m || m[1] === undefined || Number(m[1]) !== id) continue;
		// the server deactivates a branch rather than deleting it
		if (e.method === "DELETE") next = { ...next, isActive: false };
		else if (e.method === "PUT" || e.method === "PATCH") {
			const b = (e.body ?? {}) as BranchBody;
			next = {
				...next,
				...(b.name !== undefined ? { name: b.name } : {}),
				...(b.code !== undefined ? { code: String(b.code).trim().toUpperCase() } : {}),
				...(b.address !== undefined ? { address: b.address } : {}),
				...(b.phone !== undefined ? { phone: b.phone } : {}),
				...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
			};
		}
	}
	return next;
}

function branchFromCreate(e: OutboxEntry): Row {
	const b = (e.body ?? {}) as BranchBody;
	return { id: localRequestId(e.id), name: b.name ?? "", code: String(b.code ?? "").trim().toUpperCase(), address: b.address ?? "", phone: b.phone ?? "", isActive: true };
}

async function adjustBranches(path: string, cached: string | null, entries: OutboxEntry[]): Promise<string | null> {
	const p = bare(path);
	const m = BRANCH.exec(p);
	const switchable = /\/branches\/switchable$/.test(p);
	if (!m && !switchable) return cached;
	const creates = entries.filter(createsBranch);
	const touched = entries.some((e) => (e.method === "PUT" || e.method === "PATCH" || e.method === "DELETE") && BRANCH.test(bare(e.path)));
	if (m && m[1] !== undefined) {
		const id = Number(m[1]);
		if (id < 0) {
			const e = creates.find((c) => localRequestId(c.id) === id);
			return e ? JSON.stringify({ success: true, data: applyBranchEdit(branchFromCreate(e), id, entries) }) : cached;
		}
		const env = cached ? parse(cached) : null;
		if (!touched || !env || !env.data || typeof env.data !== "object") return cached;
		return JSON.stringify({ ...env, data: applyBranchEdit(env.data as Row, id, entries) });
	}
	const mgmt = !switchable && !/\/branches\/quota$/.test(p);
	const pending = mgmt ? creates : [];
	if (!touched && !pending.length) return cached;
	const env = cached ? parse(cached) : mgmt ? { success: true, data: [] } : null;
	if (!env) return cached;
	// the switcher's answer is {branches, canSwitch}
	const sw = switchable && env.data && typeof env.data === "object" ? (env.data as { branches?: Row[] }) : null;
	const rows = sw ? sw.branches : Array.isArray(env.data) ? (env.data as Row[]) : null;
	if (!rows) return cached;
	const words = (queryOf(path).get("search") || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
	const next = rows.map((r) => applyBranchEdit(r, num(r.id), entries));
	const added = pending
		.map((e) => applyBranchEdit(branchFromCreate(e), localRequestId(e.id), entries))
		.filter((r) => matchesQuery(`${r.name} ${r.code} ${r.address} ${r.phone}`, words));
	const all = [...next, ...added];
	return JSON.stringify(sw ? { ...env, data: { ...sw, branches: all } } : { ...env, data: all });
}

/* ---- business profile ---- */

async function adjustProfile(cached: string | null, entries: OutboxEntry[]): Promise<string | null> {
	const edits = entries.filter((e) => (e.method === "PUT" || e.method === "PATCH") && PROFILE.test(bare(e.path)));
	if (!edits.length || !cached) return cached;
	const env = parse(cached);
	if (!env || !env.data || typeof env.data !== "object") return cached;
	let data = env.data as Row;
	for (const e of edits) {
		const b = (e.body ?? {}) as Row;
		// the policy belongs to the platform; only the profile's own fields change
		const { policy, ...fields } = b;
		void policy;
		data = { ...data, ...fields };
	}
	return JSON.stringify({ ...env, data });
}

/* Applies what is waiting in the outbox to a cached answer; anything that is not a setup read comes back unchanged. */
export async function adjustSetup(path: string, cached: string | null, recall: Recall, view: string): Promise<string | null> {
	const p = bare(path);
	const kind = BANK.test(p) ? "bank" : BRANCH.test(p) || /\/branches\/switchable$/.test(p) ? "branch" : PROFILE.test(p) ? "profile" : "";
	if (!kind) return cached;
	const entries = await waitingEntries();
	if (!entries.length) return cached;
	if (kind === "bank") return adjustBanks(path, cached, entries, recall, view);
	if (kind === "branch") return adjustBranches(path, cached, entries);
	return adjustProfile(cached, entries);
}
