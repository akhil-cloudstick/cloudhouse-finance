/* Investment plans and investments made on this PC that the server has not been sent yet. The plan list and the
 * investment list the screens show are the server's last answer, which cannot know about them, so each waiting "create plan" /
 * "create investment" entry is added to that answer in the shape the server will use once it is sent: a plan under a local
 * id, an investment as a PENDING row. When it has been sent the server's own answer includes it and it is no longer in the
 * outbox, so nothing is shown twice. */

import { offlineStore } from "@/common/services/desktopBridge";
import { localRequestId } from "./requestRef";
import { waitingAgainst } from "./unsent";
import type { OutboxEntry } from "./types";

type Plan = Record<string, unknown> & { isActive?: boolean; tenureMonths?: number; interestRateType?: string; interestRatePercent?: number; payoutFrequency?: string; engine?: string };
type InvestmentBody = { branchId?: number; principalAmount?: number; startDate?: string };
type View = { customerName?: string; customerCode?: string; plan?: Plan & { id?: number } };

type Env = { data?: unknown; [k: string]: unknown };

async function waiting(method: string, path: string): Promise<OutboxEntry[]> {
	const found: OutboxEntry[] = [];
	for (const line of await offlineStore.readAllOutbox().catch(() => [] as string[])) {
		try {
			const entry = JSON.parse(line) as OutboxEntry;
			if (entry.method === method && entry.path === path) found.push(entry);
		} catch {
			/* a line that cannot be read adds nothing */
		}
	}
	return found;
}

function queryOf(path: string): URLSearchParams {
	return new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?") + 1) : "");
}

/* GET /investment-plans...: the waiting plans are listed after the server's, narrowed to active ones when the screen asks. */
export async function adjustInvestmentPlans(path: string, kept: string | null): Promise<string | null> {
	const activeOnly = queryOf(path).get("activeOnly") === "true";
	const rows = (await waiting("POST", "/investment-plans"))
		.map((e) => ({ id: localRequestId(e.id), ...((e.body ?? {}) as Plan) }))
		.filter((p) => !activeOnly || p.isActive !== false);
	if (!rows.length) return kept;
	let env: Env = { success: true, data: [] };
	if (kept !== null) {
		try {
			env = JSON.parse(kept) as Env;
		} catch {
			return kept;
		}
	}
	return JSON.stringify({ ...env, data: [...(Array.isArray(env.data) ? env.data : []), ...rows] });
}

function addMonths(day: string, months: number): string {
	const [y, m, d] = day.split("-").map(Number);
	if (!y || !m || !d) return day;
	return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}

/* The row the server will make for a waiting investment. */
export function pendingInvestmentRow(entry: OutboxEntry, b: InvestmentBody, v: View): Record<string, unknown> {
	const plan = v.plan ?? {};
	const principal = Number(b.principalAmount) || 0;
	const start = (b.startDate ?? entry.occurredAt).slice(0, 10);
	return {
		id: localRequestId(entry.id),
		investmentNumber: pendingInvestmentKey(entry.id),
		branchId: b.branchId ?? null,
		customerId: 0,
		customer: { id: 0, name: v.customerName ?? "—", code: v.customerCode ?? "", phone: "" },
		planId: plan.id ?? 0,
		plan,
		principalAmount: principal,
		interestRateType: plan.interestRateType,
		interestRatePercent: plan.interestRatePercent,
		payoutFrequency: plan.payoutFrequency,
		tenureMonths: plan.tenureMonths,
		startDate: start,
		maturityDate: addMonths(start, Number(plan.tenureMonths) || 0),
		status: "Active",
		totalInterestPaid: 0,
		closedAt: null,
		renewedFromInvestmentId: null,
		renewedToInvestmentId: null,
		createdAt: entry.occurredAt,
		engine: plan.engine,
		outstandingPrincipal: principal,
		accruedInterest: 0,
		interestWithdrawn: 0,
		outstandingInterest: 0,
		lastAccrualDate: null,
		syncPending: true,
	};
}

/* The pending row with what has been done to it on this PC since it was made: cash added or withdrawn, interest paid, closed. */
async function withOps(row: Record<string, unknown>, entryId: string): Promise<Record<string, unknown>> {
	let r = row;
	for (const op of await waitingAgainst(entryId, "investments")) {
		const b = op.body as { amount?: number; principalAmount?: number; interestAmount?: number };
		if (op.action === "add-cash") {
			const add = Number(b.amount) || 0;
			r = { ...r, principalAmount: (Number(r.principalAmount) || 0) + add, outstandingPrincipal: (Number(r.outstandingPrincipal) || 0) + add };
		} else if (op.action === "withdraw") {
			r = { ...r, outstandingPrincipal: Math.max(0, (Number(r.outstandingPrincipal) || 0) - (Number(b.principalAmount) || 0)), interestWithdrawn: (Number(r.interestWithdrawn) || 0) + (Number(b.interestAmount) || 0) };
		} else if (op.action === "pay-interest") {
			r = { ...r, totalInterestPaid: (Number(r.totalInterestPaid) || 0) + (Number(b.amount) || 0) };
		} else if (op.action === "close") {
			r = { ...r, status: "Closed", closedAt: op.entry.occurredAt };
		}
	}
	return r;
}

/* GET /investments...: a row for each waiting investment, on the first page, narrowed by the same search and status the
 * screen asked for. */
export async function adjustInvestments(path: string, kept: string | null): Promise<string | null> {
	const qs = queryOf(path);
	if ((Number(qs.get("offset") ?? "0") || 0) > 0) return kept;
	// a list for one investor holds the waiting investments made for that investor
	const forCustomer = qs.get("customerId") || qs.get("customer_id") || "";
	const q = (qs.get("q") ?? "").trim().toLowerCase();
	const status = (qs.get("status") ?? "").toLowerCase();
	const rows = (await Promise.all((await waiting("POST", "/investments"))
		.filter((e) => !forCustomer || isOfCustomer(e, forCustomer))
		.map((e) => withOps(pendingInvestmentRow(e, (e.body ?? {}) as InvestmentBody, (e.view ?? {}) as View), e.id))))
		.filter((r) => {
			const c = r.customer as { name: string; code: string };
			return (!q || `${r.investmentNumber} ${c.name} ${c.code}`.toLowerCase().includes(q)) && (!status || status === String(r.status).toLowerCase());
		})
		.reverse();
	if (!rows.length) return kept;
	let env: Env = { success: true, data: { items: [], hasMore: false, total: 0 } };
	if (kept !== null) {
		try {
			env = JSON.parse(kept) as Env;
		} catch {
			return kept;
		}
	}
	if (Array.isArray(env.data)) return JSON.stringify({ ...env, data: [...rows, ...env.data] });
	const d = env.data as { items?: unknown[]; hasMore?: boolean; total?: number } | undefined;
	if (!d || !Array.isArray(d.items)) return kept;
	const limit = Number(qs.get("limit") ?? "0") || d.items.length + rows.length;
	const total = (d.total ?? d.items.length) + rows.length;
	return JSON.stringify({ ...env, data: { ...d, items: [...rows, ...d.items].slice(0, limit), total, hasMore: total > limit } });
}

/* ---- opening an investment made on this PC and not sent yet -----------------------------------------------------------
 * The server has not numbered it, so the lists show it under a local number (PENDING-XXXXXX) and a local (negative) id. The
 * investment page finds an investment by its number and then reads it by id; both answers come from the waiting entry, so it
 * opens (with nothing yet in its ledger, schedule or transactions) instead of "not found". */

export const pendingInvestmentKey = (entryId: string) => "PENDING-" + entryId.replace(/-/g, "").slice(-6).toUpperCase();

/* GET /investments/by-number/PENDING-XXXXXX */
export async function adjustPendingInvestmentByNumber(path: string): Promise<string | null> {
	const m = /\/investments\/by-number\/(PENDING-[0-9A-F]{6})(\?|$)/i.exec(path);
	if (!m) return null;
	const hit = (await waiting("POST", "/investments")).find((e) => pendingInvestmentKey(e.id) === m[1].toUpperCase());
	return hit ? JSON.stringify({ success: true, data: { id: localRequestId(hit.id) } }) : null;
}

/* GET /investments/<local id> and its ledger / schedule / transactions / pending-interest. Null when the path is not one of these. */
export async function adjustPendingInvestmentPages(path: string): Promise<string | null> {
	const m = /\/investments\/(-\d+)(\/(ledger|schedule|transactions|pending-interest))?(\?|$)/.exec(path);
	if (!m) return null;
	const id = Number(m[1]);
	const hit = (await waiting("POST", "/investments")).find((e) => localRequestId(e.id) === id);
	if (!hit) return null;
	const row = pendingInvestmentRow(hit, (hit.body ?? {}) as InvestmentBody, (hit.view ?? {}) as View);
	if (!m[3]) return JSON.stringify({ success: true, data: await withOps(row, hit.id) });
	if (m[3] === "ledger" || m[3] === "transactions") {
		const ops = await opsOn(`ref:${hit.id}`);
		if (m[3] === "ledger") {
			const opening = { id: `pending-${hit.id}`, date: hit.occurredAt, description: "Opening deposit", type: "Deposit", method: "Cash", reference: "", debitOrCredit: "credit", amount: row.principalAmount, principalAmount: row.principalAmount, interestAmount: 0, runningBalance: row.principalAmount, entryKind: "opening", editable: false, deletable: false };
			const items = ledgerRowsOf(ops, Number(row.principalAmount) || 0);
			return JSON.stringify({ success: true, data: { items: [opening, ...items], hasMore: false, total: items.length + 1 } });
		}
		const items = transactionRowsOf(ops, Number(m[1]), Number(row.principalAmount) || 0);
		return JSON.stringify({ success: true, data: { items, hasMore: false, total: items.length } });
	}
	return JSON.stringify({ success: true, data: { items: [], hasMore: false, total: 0 } });
}

/* ---- what is done to an investment on this PC and not sent yet, in its ledger, transactions and schedule ----------------- */

type Op = { action: string; body: Record<string, unknown>; entry: OutboxEntry };

/* The waiting entries addressed to one investment: by its server id, or as ref:<entry id> for one made on this PC. */
async function opsOn(idPart: string): Promise<Op[]> {
	const out: Op[] = [];
	const prefix = `/investments/${idPart}/`;
	for (const line of await offlineStore.readAllOutbox().catch(() => [] as string[])) {
		try {
			const e = JSON.parse(line) as OutboxEntry;
			if (e.method === "POST" && e.path.startsWith(prefix)) out.push({ action: e.path.slice(prefix.length).split("?")[0], body: (e.body ?? {}) as Record<string, unknown>, entry: e });
		} catch {
			/* a line that cannot be read adds nothing */
		}
	}
	return out;
}

const num = (v: unknown) => Number(v) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;

function methodOf(b: Record<string, unknown>): string {
	const modes = [["cashAmount", "Cash"], ["upiAmount", "UPI"], ["bankTransferAmount", "Bank Transfer"], ["chequeAmount", "Cheque"]].filter(([k]) => num(b[k]) > 0).map(([, m]) => m);
	return modes.join(" + ") || "Cash";
}

function dateOf(op: Op): string {
	const on = op.body.occurredOn;
	return typeof on === "string" && on ? on : op.entry.occurredAt;
}

/* The ledger rows these entries add (oldest first), the balance carried on from `start`. */
function ledgerRowsOf(ops: Op[], start: number): Record<string, unknown>[] {
	let balance = start;
	const rows: Record<string, unknown>[] = [];
	for (const op of ops) {
		const b = op.body;
		const split = num(b.cashAmount) + num(b.upiAmount) + num(b.bankTransferAmount) + num(b.chequeAmount);
		let row: { description: string; type: string; credit: boolean; amount: number; principal: number; interest: number; kind: string } | null = null;
		if (op.action === "add-cash") {
			const a = num(b.amount) || split;
			row = { description: "Cash added", type: "Deposit", credit: true, amount: a, principal: a, interest: 0, kind: "deposit" };
		} else if (op.action === "withdraw") {
			const p = num(b.principalAmount);
			const i = num(b.interestAmount);
			row = { description: "Withdrawal", type: "Withdrawal", credit: false, amount: p + i, principal: p, interest: i, kind: "withdrawal" };
		} else if (/^payouts\/\d+\/pay$/.test(op.action)) {
			row = { description: "Payout", type: "Payout", credit: false, amount: split, principal: 0, interest: split, kind: "payout" };
		} else if (op.action === "pay-interest") {
			const a = num(b.amount) || split;
			row = { description: "Interest paid", type: "Payout", credit: false, amount: a, principal: 0, interest: a, kind: "payout" };
		} else if (op.action === "mature" && b.action === "Close") {
			row = { description: "Maturity payout", type: "Payout", credit: false, amount: split, principal: split, interest: 0, kind: "payout" };
		}
		if (!row || row.amount <= 0) continue;
		balance = round2(balance + (row.credit ? row.principal : -row.principal));
		rows.push({
			id: `pending-${op.entry.id}`, date: dateOf(op), description: row.description, type: row.type, method: methodOf(b), reference: "",
			debitOrCredit: row.credit ? "credit" : "debit", amount: round2(row.amount), principalAmount: round2(row.principal), interestAmount: round2(row.interest),
			runningBalance: balance, entryKind: row.kind, entryAmount: round2(row.amount), cashAmount: num(b.cashAmount), upiAmount: num(b.upiAmount),
			bankTransferAmount: num(b.bankTransferAmount), chequeAmount: num(b.chequeAmount), bankId: num(b.bankId) || null, editable: false, deletable: false,
		});
	}
	return rows;
}

/* The transaction rows (cash added, withdrawals) these entries add, newest first. */
function transactionRowsOf(ops: Op[], investmentId: number, start: number): Record<string, unknown>[] {
	let principal = start;
	const rows: Record<string, unknown>[] = [];
	for (const op of ops) {
		const b = op.body;
		const isAdd = op.action === "add-cash";
		if (!isAdd && op.action !== "withdraw") continue;
		const a = isAdd ? num(b.amount) || num(b.cashAmount) + num(b.upiAmount) + num(b.bankTransferAmount) + num(b.chequeAmount) : 0;
		const p = isAdd ? a : num(b.principalAmount);
		const i = isAdd ? 0 : num(b.interestAmount);
		const before = principal;
		principal = round2(principal + (isAdd ? p : -p));
		rows.push({
			id: -rows.length - 1, investmentId, type: isAdd ? "Deposit" : "Withdrawal", amount: round2(isAdd ? a : p + i), principalAmount: round2(p), interestAmount: round2(i),
			cashAmount: num(b.cashAmount), upiAmount: num(b.upiAmount), bankTransferAmount: num(b.bankTransferAmount), chequeAmount: num(b.chequeAmount),
			principalBefore: before, principalAfter: principal, interestBefore: 0, interestAfter: 0, occurredOn: dateOf(op), recordedByEmployeeId: null,
			reference: typeof b.reference === "string" ? b.reference : "", cashMovementId: null, createdAt: op.entry.occurredAt,
		});
	}
	return rows.reverse();
}

/* GET /investments/<id>/ledger | transactions | schedule of an investment the server knows: what was done to it on this PC and
 * not sent yet is added to the last answer. The ledger runs oldest first, so its new rows follow the last page. */
export async function adjustInvestmentOps(path: string, kept: string | null): Promise<string | null> {
	const m = /\/investments\/(\d+)\/(ledger|transactions|schedule)(\?|$)/.exec(path);
	if (!m || kept === null) return kept;
	const ops = await opsOn(m[1]);
	if (!ops.length) return kept;
	let env: Env;
	try {
		env = JSON.parse(kept) as Env;
	} catch {
		return kept;
	}
	const d = env.data as { items?: Record<string, unknown>[] | null; hasMore?: boolean; total?: number } | undefined;
	if (!d) return kept;
	const items = Array.isArray(d.items) ? d.items : [];
	if (m[2] === "ledger") {
		if (d.hasMore) return kept;
		const add = ledgerRowsOf(ops, num(items[items.length - 1]?.runningBalance));
		if (!add.length) return kept;
		return JSON.stringify({ ...env, data: { ...d, items: [...items, ...add], total: (d.total ?? items.length) + add.length } });
	}
	if (m[2] === "transactions") {
		if ((Number(queryOf(path).get("offset") ?? "0") || 0) > 0) return kept;
		const add = transactionRowsOf(ops, Number(m[1]), 0);
		if (!add.length) return kept;
		return JSON.stringify({ ...env, data: { ...d, items: [...add, ...items], total: (d.total ?? items.length) + add.length } });
	}
	// the schedule: a payout paid on this PC shows as paid
	const paid = new Map<number, Op>();
	for (const op of ops) {
		const p = /^payouts\/(\d+)\/pay$/.exec(op.action);
		if (p) paid.set(Number(p[1]), op);
	}
	if (!paid.size) return kept;
	return JSON.stringify({
		...env,
		data: {
			...d,
			items: items.map((r) => {
				const op = paid.get(Number(r.id));
				return op ? { ...r, status: "Paid", paidAt: op.entry.occurredAt, cashAmount: num(op.body.cashAmount), upiAmount: num(op.body.upiAmount), bankTransferAmount: num(op.body.bankTransferAmount), chequeAmount: num(op.body.chequeAmount) } : r;
			}),
		},
	});
}

/* Whether a waiting investment belongs to the investor a list asks for: by the investor's server id, or, for an investor made on
 * this PC and not sent yet, by the local id ("uuid:<id>") the entry points at. */
function isOfCustomer(e: OutboxEntry, customerRef: string): boolean {
	const ref = (e.body as { customerId?: number | string } | undefined)?.customerId;
	return ref !== undefined && String(ref) === customerRef;
}

/* GET /customers/<id>/investments: the investor's investments, with the ones made for them on this PC and not sent yet. */
export async function adjustCustomerInvestments(path: string, kept: string | null): Promise<string | null> {
	const m = /\/(?:customers|investors)\/([^/?]+)\/investments(\?|$)/.exec(path);
	if (!m) return kept;
	const ref = decodeURIComponent(m[1]);
	const rows = (await Promise.all((await waiting("POST", "/investments"))
		.filter((e) => isOfCustomer(e, ref))
		.map((e) => withOps(pendingInvestmentRow(e, (e.body ?? {}) as InvestmentBody, (e.view ?? {}) as View), e.id))))
		.reverse();
	if (!rows.length) return kept;
	let env: Env = { success: true, data: [] };
	if (kept !== null) {
		try {
			env = JSON.parse(kept) as Env;
		} catch {
			return kept;
		}
	}
	return JSON.stringify({ ...env, data: [...rows, ...(Array.isArray(env.data) ? env.data : [])] });
}
