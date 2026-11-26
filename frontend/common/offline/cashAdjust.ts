/* Cash while the server does not answer. The cash figures and the cash ledger the screens show are the server's
 * last answer, which cannot know about a disbursal or a payment taken on this PC since. This adds the entries still
 * waiting in the outbox to that answer: cash in hand and the bank balance move, and the ledger lists a row for each
 * payment mode used, the same as it will once the entry is sent. When an entry has been sent the server's own
 * figures and rows include it and it is no longer in the outbox, so nothing is counted twice.
 *
 * Only entries that move money count: the final approval of a loan (its payout amounts), a payment, and a bank pledge
 * release (what is paid back to the bank). Creating a
 * loan, or an approval stage that is not the last one, does not touch cash. */

import { offlineStore } from "@/common/services/desktopBridge";
import { getLocal, listLocal } from "./localCopy";
import type { OutboxEntry } from "./types";

const MOVES_MONEY = /^\/loans\/uuid:([0-9a-f-]+)\/(approve|payments|topup|bank-pledge\/(\d+|ref:[0-9a-f-]+)\/release)$/i;
const CASH_ENTRY = /^\/(cash-movements|expenses)$/;
const SELF_TRANSFER = /^\/cash-movements\/self-transfer$/;
const RELEASE_PAYMENT = /^\/loans\/requests\/\d+\/release-payment$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const round2 = (n: number) => Math.round(n * 100) / 100;

function today(): string {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function queryOf(path: string): URLSearchParams {
	return new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?") + 1) : "");
}

export type Part = { mode: string; amount: number; bankId?: number; bankName?: string };
export type Pending = {
	entry: OutboxEntry;
	out: boolean; // a disbursal (money out) as opposed to a payment (money in)
	parts: Part[];
	loanNumber: string;
	branchId: number | null;
	customerId: number | null;
	label?: string;
	source?: string; // the cash movement's source (the cash-in category, "Self Transfer", "GoldSale")
	category?: string; // an expense's category
	expense?: boolean;
	on?: string; // the date the person picked on the form, "YYYY-MM-DD"
	remarks?: string;
};

/* When a waiting entry happened: the date picked on the form, at the time it was saved. */
export function whenOf(p: Pending): string {
	return p.on ? `${p.on.slice(0, 10)}T${p.entry.occurredAt.slice(11)}` : p.entry.occurredAt;
}

/* What the ledger and the cash list call the entry. */
export function purposeOf(p: Pending): string {
	return p.label ?? (p.out ? `Loan disbursement — ${p.loanNumber}` : `${(p.entry.body as { type?: string } | undefined)?.type ?? "Payment"} — ${p.loanNumber}`);
}

/* The waiting entries that move money, newest first. */
export async function pendingMoney(branch: number): Promise<Pending[]> {
	const found: Pending[] = [];
	for (const line of await offlineStore.readAllOutbox().catch(() => [] as string[])) {
		let entry: OutboxEntry;
		try {
			entry = JSON.parse(line) as OutboxEntry;
		} catch {
			continue;
		}
		// cash added or paid out by hand (Add Cash)
		if (entry.method === "POST" && CASH_ENTRY.test(entry.path)) {
			const isExpense = entry.path === "/expenses";
			const cb = (entry.body ?? {}) as { type?: string; source?: string; purpose?: string; category?: string; amount?: number; mode?: string; bankId?: number; fromBankId?: number; branchId?: number; occurredOn?: string; remarks?: string; payments?: { mode: string; amount: number; bankId?: number }[] };
			const cparts: Part[] = (cb.payments?.length ? cb.payments : [{ mode: cb.mode ?? "Cash", amount: Number(cb.amount) || 0, bankId: cb.bankId ?? cb.fromBankId }])
				.map((p) => ({ mode: p.mode || "Cash", amount: Number(p.amount) || 0, bankId: p.bankId }))
				.filter((p) => p.amount > 0);
			if (!cparts.length || (branch && cb.branchId && Number(cb.branchId) !== branch)) continue;
			const label = isExpense ? `Expense — ${cb.category ?? ""}`.trim() : cb.source || cb.purpose || "Cash entry";
			found.push({
				entry, out: isExpense || cb.type === "out", parts: cparts, loanNumber: label, branchId: cb.branchId ?? null, customerId: null, label,
				source: isExpense ? undefined : cb.source, category: isExpense ? cb.category : undefined, expense: isExpense, on: cb.occurredOn, remarks: cb.remarks,
			});
			continue;
		}
		// a self transfer moves money between cash and a bank, or between two banks: a debit and a credit, the same as the server books it.
		// A repayment to a lender (no To bank) leaves the business, so only its debit is booked.
		if (entry.method === "POST" && SELF_TRANSFER.test(entry.path)) {
			const sb = (entry.body ?? {}) as { category?: string; amount?: number; fromBankId?: number; fromBank?: string; toBankId?: number; toBank?: string; mode?: string; branchId?: number; occurredOn?: string; remarks?: string };
			const amount = Number(sb.amount) || 0;
			if (amount <= 0 || (branch && sb.branchId && Number(sb.branchId) !== branch)) continue;
			const category = (sb.category ?? "").trim();
			const cashToBank = category.toLowerCase() === "cash to bank";
			const bankToCash = category.toLowerCase() === "bank to cash";
			const mode = sb.mode || "Bank Transfer";
			const label = `Self transfer — ${category}`;
			const base = { entry, loanNumber: label, branchId: sb.branchId ?? null, customerId: null, label, source: "Self Transfer", on: sb.occurredOn, remarks: sb.remarks };
			found.push({ ...base, out: true, parts: [cashToBank ? { mode: "Cash", amount } : { mode, amount, bankId: sb.fromBankId, bankName: sb.fromBank }] });
			if (bankToCash || sb.toBankId) found.push({ ...base, out: false, parts: [bankToCash ? { mode: "Cash", amount } : { mode, amount, bankId: sb.toBankId, bankName: sb.toBank }] });
			continue;
		}
		// a gold sale takes the sale in (in the mode it was received) and pays the cost to acquire out (in the mode it was paid)
		if (entry.method === "POST" && entry.path === "/gold-sales") {
			const gb = (entry.body ?? {}) as { ornamentType?: string; soldAmount?: number; costAmount?: number; costMode?: string; costBankId?: number; branchId?: number; mode?: string; bankId?: number; soldOn?: string; remarks?: string };
			if (branch && gb.branchId && Number(gb.branchId) !== branch) continue;
			const sold = Number(gb.soldAmount) || 0;
			const cost = Number(gb.costAmount) || 0;
			const type = (gb.ornamentType ?? "").trim();
			const base = { entry, branchId: gb.branchId ?? null, customerId: null, on: gb.soldOn, remarks: gb.remarks };
			if (cost > 0) found.push({ ...base, out: true, parts: [{ mode: gb.costMode || "Cash", amount: cost, bankId: gb.costBankId }], loanNumber: `Gold purchase cost — ${type}`, label: `Gold purchase cost — ${type}` });
			if (sold > 0) found.push({ ...base, out: false, parts: [{ mode: gb.mode || "Cash", amount: sold, bankId: gb.bankId }], loanNumber: `Gold sale — ${type}`, label: `Gold sale — ${type}`, source: "GoldSale" });
			continue;
		}
		// a personal loan made on this PC pays the customer out at once, unless it waits for approval first
		if (entry.method === "POST" && entry.path === "/personal-loans") {
			const pb = (entry.body ?? {}) as { branchId?: number; cashAmount?: number; upiAmount?: number; bankTransferAmount?: number; chequeAmount?: number; bankId?: number };
			const view = (entry.view ?? {}) as { status?: string; customerName?: string };
			if (view.status === "Pending Approval" || (branch && pb.branchId && Number(pb.branchId) !== branch)) continue;
			const pparts: Part[] = [
				{ mode: "Cash", amount: Number(pb.cashAmount) || 0 },
				{ mode: "UPI", amount: Number(pb.upiAmount) || 0, bankId: pb.bankId },
				{ mode: "Bank Transfer", amount: Number(pb.bankTransferAmount) || 0, bankId: pb.bankId },
				{ mode: "Cheque", amount: Number(pb.chequeAmount) || 0, bankId: pb.bankId },
			].filter((p) => p.amount > 0);
			// no breakdown given means all cash, as the server reads it: the amount handed over (the principal less the interest
			// kept up front, or the whole principal for a full disbursement)
			if (!pparts.length) {
				const full = (entry.body as { fullDisbursement?: boolean; principalAmount?: number; interestType?: string; interestValue?: number } | undefined) ?? {};
				const principal = Math.round(Number(full.principalAmount) || 0);
				const value = Number(full.interestValue) || 0;
				const interest = Math.round(full.interestType === "Percentage" ? (principal * value) / 100 : value);
				const handed = full.fullDisbursement ? principal : Math.max(0, principal - interest);
				if (handed > 0) pparts.push({ mode: "Cash", amount: handed });
			}
			if (!pparts.length) continue;
			const number = "Pending";
			found.push({ entry, out: true, parts: pparts, loanNumber: number, branchId: pb.branchId ?? null, customerId: null, label: `Personal loan disbursement — ${number}` });
			continue;
		}
		// an investment made on this PC takes the investor's deposit in at once
		if (entry.method === "POST" && entry.path === "/investments") {
			const ib = (entry.body ?? {}) as { branchId?: number; principalAmount?: number; cashAmount?: number; upiAmount?: number; bankTransferAmount?: number; chequeAmount?: number; bankId?: number };
			if (branch && ib.branchId && Number(ib.branchId) !== branch) continue;
			let iparts: Part[] = [
				{ mode: "Cash", amount: Number(ib.cashAmount) || 0 },
				{ mode: "UPI", amount: Number(ib.upiAmount) || 0, bankId: ib.bankId },
				{ mode: "Bank Transfer", amount: Number(ib.bankTransferAmount) || 0, bankId: ib.bankId },
				{ mode: "Cheque", amount: Number(ib.chequeAmount) || 0, bankId: ib.bankId },
			].filter((p) => p.amount > 0);
			// no breakdown given means all cash, as the server reads it
			if (!iparts.length && Number(ib.principalAmount) > 0) iparts = [{ mode: "Cash", amount: Number(ib.principalAmount) }];
			if (!iparts.length) continue;
			const inumber = "Pending";
			found.push({ entry, out: false, parts: iparts, loanNumber: inumber, branchId: ib.branchId ?? null, customerId: null, label: `Investment deposit — ${inumber}` });
			continue;
		}
		// what is done to an investment: cash added comes in; a withdrawal, a payout, interest paid and a closing payout go out
		const inv = entry.method === "POST" ? /^\/investments\/(?:ref:[0-9a-f-]+|\d+)\/(add-cash|withdraw|pay-interest|payouts\/\d+\/pay|mature)$/i.exec(entry.path) : null;
		if (inv) {
			const ob = (entry.body ?? {}) as { amount?: number; principalAmount?: number; interestAmount?: number; cashAmount?: number; upiAmount?: number; bankTransferAmount?: number; chequeAmount?: number; bankId?: number; occurredOn?: string; action?: string };
			const action = inv[1].toLowerCase();
			if (action === "mature" && ob.action !== "Close") continue;
			const obank = Number(ob.bankId) || undefined;
			let oparts: Part[] = [
				{ mode: "Cash", amount: Number(ob.cashAmount) || 0 },
				{ mode: "UPI", amount: Number(ob.upiAmount) || 0, bankId: obank },
				{ mode: "Bank Transfer", amount: Number(ob.bankTransferAmount) || 0, bankId: obank },
				{ mode: "Cheque", amount: Number(ob.chequeAmount) || 0, bankId: obank },
			].filter((p) => p.amount > 0);
			// no breakdown given means all cash, as the server reads it
			const total = Number(ob.amount) || (Number(ob.principalAmount) || 0) + (Number(ob.interestAmount) || 0);
			if (!oparts.length && total > 0) oparts = [{ mode: "Cash", amount: total }];
			if (!oparts.length) continue;
			const olabel = action === "add-cash" ? "Investment deposit" : action === "withdraw" ? "Investment withdrawal" : action === "mature" ? "Investment maturity payout" : "Investment payout";
			found.push({ entry, out: action !== "add-cash", parts: oparts, loanNumber: olabel, branchId: null, customerId: null, label: olabel, on: ob.occurredOn });
			continue;
		}
		// a bank pledge whose money is received as cash in: what the bank paid (in each mode) comes in, to the bank it was received in
		const pledge = entry.method === "POST" ? /^\/loans\/(uuid:([0-9a-f-]+)|(\d+))\/bank-pledge$/i.exec(entry.path) : null;
		if (pledge) {
			const pb = (entry.body ?? {}) as { cashTreatment?: string; cashAmount?: number; upiAmount?: number; bankTransferAmount?: number; chequeAmount?: number; receivedBankId?: number; bankName?: string; pledgeDate?: string; pledgedAmount?: number };
			if (pb.cashTreatment !== "CashIn") continue;
			const rbank = Number(pb.receivedBankId) || undefined;
			const pparts: Part[] = [
				{ mode: "Cash", amount: Number(pb.cashAmount) || 0 },
				{ mode: "UPI", amount: Number(pb.upiAmount) || 0, bankId: rbank },
				{ mode: "Bank Transfer", amount: Number(pb.bankTransferAmount) || 0, bankId: rbank },
				{ mode: "Cheque", amount: Number(pb.chequeAmount) || 0, bankId: rbank },
			].filter((p) => p.amount > 0);
			if (!pparts.length) continue;
			const pl = (pledge[2]
				? getLocal("loans", pledge[2])
				: listLocal("loans").find((l) => (l as { id?: number }).id === Number(pledge[3]))) as { branchId?: number; customerId?: number; loanNumber?: string } | undefined;
			if (branch && pl?.branchId && Number(pl.branchId) !== branch) continue;
			const plabel = `Bank pledge — ${pb.bankName ?? ""}${pl?.loanNumber ? ` (${pl.loanNumber})` : ""}`.trim();
			found.push({ entry, out: false, parts: pparts, loanNumber: pl?.loanNumber ?? plabel, branchId: pl?.branchId ?? null, customerId: pl?.customerId || null, label: plabel, on: pb.pledgeDate });
			continue;
		}
		let m = MOVES_MONEY.exec(entry.path);
		// a payment taken on a release request: it addresses the request, the loan is the other target of the entry
		if (!m && entry.method === "POST" && RELEASE_PAYMENT.test(entry.path)) {
			const loanUuid = entry.targets?.find((t) => UUID.test(t));
			if (loanUuid) m = [entry.path, loanUuid, "payments"] as unknown as RegExpExecArray;
		}
		if (!m) continue;
		const b = (entry.body ?? {}) as Record<string, unknown>;
		const bankId = Number(b.bankId) || undefined;
		const parts: Part[] = [
			{ mode: "Cash", amount: Number(b.cashAmount) || 0 },
			{ mode: "UPI", amount: Number(b.upiAmount) || 0, bankId },
			{ mode: "Bank Transfer", amount: Number(b.bankTransferAmount) || 0, bankId },
			{ mode: "Cheque", amount: Number(b.chequeAmount) || 0, bankId },
		].filter((p) => p.amount > 0);
		if (!parts.length) continue; // an approval stage that is not the payout, or a payment with no amounts
		const out = m[2].toLowerCase() !== "payments"; // a disbursal or a bank pledge release pays money out
		if (out && b.action === "Rejected") continue;
		const loan = getLocal("loans", m[1]) as { branchId?: number; customerId?: number; loanNumber?: string } | undefined;
		if (branch && loan && Number(loan.branchId) !== branch) continue;
		const loanNumber = loan?.loanNumber || `PENDING-${m[1].replace(/-/g, "").slice(-8).toUpperCase()}`;
		found.push({
			entry,
			out,
			parts,
			loanNumber,
			branchId: loan?.branchId ?? null,
			customerId: loan?.customerId || null,
			label: m[2].toLowerCase() === "topup" ? `Loan top-up — ${loanNumber}` : undefined,
		});
	}
	return found.reverse();
}

type Summary = {
	cashInHand: number;
	bankBalance: number;
	disbursements?: number;
	collections?: number;
	expectedCash?: number;
};

/* The cash summary: cash in hand, bank balance, and the day's collections and disbursements. */
export async function adjustCashSummary(path: string, body: string): Promise<string> {
	const qs = queryOf(path);
	const date = qs.get("date");
	// a past day's figures do not change with what is entered now
	if (date && date !== today()) return body;
	const branch = Number(qs.get("branch_id") ?? qs.get("branchId") ?? "0") || 0;

	let env: { data?: Summary };
	try {
		env = JSON.parse(body) as { data?: Summary };
	} catch {
		return body;
	}
	const sum = env.data;
	if (!sum || typeof sum.cashInHand !== "number" || typeof sum.bankBalance !== "number") return body;

	let cash = 0;
	let bank = 0;
	let out = 0;
	let inn = 0;
	for (const p of await pendingMoney(branch)) {
		const total = p.parts.reduce((s, x) => s + x.amount, 0);
		const c = p.parts.filter((x) => x.mode === "Cash").reduce((s, x) => s + x.amount, 0);
		const sign = p.out ? -1 : 1;
		cash += sign * c;
		bank += sign * (total - c);
		if (p.out) out += total;
		else inn += total;
	}
	if (!cash && !bank) return body;

	sum.cashInHand = round2(sum.cashInHand + cash);
	sum.bankBalance = round2(sum.bankBalance + bank);
	if (typeof sum.disbursements === "number") sum.disbursements = round2(sum.disbursements + out);
	if (typeof sum.collections === "number") sum.collections = round2(sum.collections + inn);
	if (typeof sum.expectedCash === "number") sum.expectedCash = round2(sum.expectedCash + cash);
	return JSON.stringify(env);
}

/* The bank list: each account's balance moves with the queued entries that went through it. */
export async function adjustBanks(body: string): Promise<string> {
	let env: { data?: unknown };
	try {
		env = JSON.parse(body) as { data?: unknown };
	} catch {
		return body;
	}
	const pending = await pendingMoney(0);
	if (!pending.length) return body;
	const delta = new Map<number, number>();
	for (const p of pending) {
		for (const part of p.parts) {
			if (part.mode === "Cash" || !part.bankId) continue;
			delta.set(part.bankId, (delta.get(part.bankId) ?? 0) + (p.out ? -part.amount : part.amount));
		}
	}
	if (!delta.size) return body;
	const data = env.data as { items?: { id: number; balance?: number }[]; totalBalance?: number } | { id: number; balance?: number }[] | undefined;
	const rows = Array.isArray(data) ? data : data?.items;
	if (!Array.isArray(rows)) return body;
	let moved = 0;
	for (const r of rows) {
		const d = delta.get(r.id);
		if (d && typeof r.balance === "number") {
			r.balance = round2(r.balance + d);
			moved += d;
		}
	}
	if (!Array.isArray(data) && data && typeof data.totalBalance === "number") data.totalBalance = round2(data.totalBalance + moved);
	return JSON.stringify(env);
}

type Row = Record<string, unknown>;

export function movementRows(pending: Pending[]): Row[] {
	const rows: Row[] = [];
	let n = 0;
	for (const p of pending) {
		for (const part of p.parts) {
			n += 1;
			rows.push({
				id: -n, // not on the server yet; never clashes with a real id
				type: p.out ? "out" : "in",
				...(p.source ? { source: p.source } : p.out ? {} : { source: "Collection" }),
				purpose: purposeOf(p),
				mode: part.mode,
				bankId: part.bankId ?? null,
				...(part.bankName ? { bank: part.bankName } : {}),
				amount: part.amount,
				remarks: p.remarks ?? "",
				status: "",
				branchId: p.branchId,
				occurredOn: whenOf(p),
				createdAt: p.entry.occurredAt,
				transactionGroupId: `offline-${p.entry.id}`,
				partyCustomerId: p.customerId,
			});
		}
	}
	return rows;
}

/* The cash ledger (Cash page, dashboard): the waiting entries are listed at the top, newest first, with the balance
 * carried on from them. Only the first page of an unfiltered list is changed; with a filter on, the server's own
 * view is shown as it was. */
export async function adjustCashMovements(path: string, body: string): Promise<string> {
	const qs = queryOf(path);
	// filters on what a waiting row has: its type, mode and date are applied to the waiting rows themselves
	for (const filter of ["category", "customer_ids", "customerIds", "branch_ids", "branchIds", "search"]) {
		if (qs.get(filter)) return body;
	}
	const page = Number(qs.get("page") ?? "1") || 1;
	if (page > 1 || (Number(qs.get("offset") ?? "0") || 0) > 0) return body;
	const branch = Number(qs.get("branch_id") ?? qs.get("branchId") ?? "0") || 0;
	const csv = (...keys: string[]) => (keys.map((k) => qs.get(k)).find((v) => v) ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
	const types = csv("types");
	const modes = csv("modes");
	const from = qs.get("from_date") ?? qs.get("fromDate") ?? "";
	const to = qs.get("to_date") ?? qs.get("toDate") ?? "";

	let env: { data?: unknown };
	try {
		env = JSON.parse(body) as { data?: unknown };
	} catch {
		return body;
	}
	const rows = movementRows(await pendingMoney(branch)).filter((r) => {
		const day = String(r.occurredOn ?? "").slice(0, 10);
		return (!types.length || types.includes(String(r.type).toLowerCase())) &&
			(!modes.length || modes.includes(String(r.mode).toLowerCase())) &&
			(!from || day >= from) && (!to || day <= to);
	});
	if (!rows.length) return body;

	const data = env.data;
	// an unpaged list (the dashboard's) is just an array
	if (Array.isArray(data)) {
		env.data = [...rows, ...data];
		return JSON.stringify(env);
	}
	const d = data as { items?: Row[]; hasMore?: boolean; total?: number; totalDebit?: number; totalCredit?: number; pageBalance?: number; rowBalances?: number[]; row_balances?: number[] } | undefined;
	if (!d || !Array.isArray(d.items)) return body;
	// a ledger that keeps one balance per row (a filtered view) is left as the server gave it
	if (d.rowBalances || d.row_balances) return body;

	const limit = Number(qs.get("limit") ?? "0") || d.items.length + rows.length;
	const outTotal = rows.filter((r) => r.type === "out").reduce((s, r) => s + Number(r.amount), 0);
	const inTotal = rows.filter((r) => r.type === "in").reduce((s, r) => s + Number(r.amount), 0);
	d.items = [...rows, ...d.items].slice(0, limit);
	d.total = (d.total ?? 0) + rows.length;
	d.hasMore = d.total > limit;
	if (typeof d.totalDebit === "number") d.totalDebit = round2(d.totalDebit + outTotal);
	if (typeof d.totalCredit === "number") d.totalCredit = round2(d.totalCredit + inTotal);
	if (typeof d.pageBalance === "number") d.pageBalance = round2(d.pageBalance + inTotal - outTotal);
	return JSON.stringify(env);
}
