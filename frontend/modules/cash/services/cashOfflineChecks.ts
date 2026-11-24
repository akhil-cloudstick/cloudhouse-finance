/* Offline pre-queue checks for cash operations, mirroring backend Cash controllers (movement.go, expense.go, gold_sale.go,
 * category.go). Used only in the offline (queueing) branch; they block only when the answer is certain from local data. */

import { apiFetchEnveloped } from "@/common/services/httpClient";
import { refuse, requirePositive, requireNotNegative } from "@/common/offline/validate";
import { fetchApprovalWorkflow } from "@/common/services/approvalWorkflowService";
import type { CashMovementInput, SelfTransferInput, ExpenseFormInput, GoldSaleInput } from "@/modules/cash/types/cash-types";

const MODES = ["Cash", "UPI", "Bank Transfer"];
const blank = (v: unknown) => !String(v ?? "").trim();
const bankMode = (m?: string) => m === "UPI" || m === "Bank Transfer";

/* true only when the cached workflow says the expense approval flow is switched off. */
export async function expenseFlowIsOff(): Promise<boolean> {
	try {
		const cfg = await fetchApprovalWorkflow();
		const flow = cfg.find((f) => f.key === "expense");
		return !!flow && !flow.stages.some((s) => s.enabled);
	} catch {
		return false;
	}
}

function checkParts(parts: { mode?: string; amount?: number; bankId?: number | null }[] | undefined, total: number) {
	if (!parts?.length) return;
	let sum = 0;
	for (const p of parts) {
		if (!(Number(p.amount) > 0)) refuse("every payment amount must be greater than zero");
		if (!MODES.includes(p.mode ?? "Cash")) refuse("payment mode must be Cash, UPI or Bank Transfer");
		if (bankMode(p.mode) && !p.bankId) refuse("bank is required when mode is UPI or Bank Transfer");
		sum += Number(p.amount);
	}
	if (Math.abs(sum - total) > 0.005) refuse("payment breakdown must add up to the amount");
}

export function checkMovement(i: CashMovementInput) {
	requirePositive(i.amount, "amount must be greater than zero");
	if (i.type === "in") {
		if (blank(i.source)) refuse("source is required for cash-in movements");
		if (!i.payments?.length && blank(i.mode)) refuse("mode of cash is required for cash-in movements");
	} else if (blank(i.purpose)) refuse("purpose is required for cash-out movements");
	if (i.payments?.length) checkParts(i.payments, i.amount);
	else {
		const mode = i.mode || (i.type === "out" ? "Cash" : "");
		if (mode && !MODES.includes(mode)) refuse("mode must be Cash, UPI or Bank Transfer");
		if (bankMode(mode) && !i.bankId) refuse("bank is required when mode is UPI or Bank Transfer");
	}
}

export function checkSelfTransfer(i: SelfTransferInput) {
	const cat = (i.category ?? "").trim();
	if (!cat) refuse("category is required");
	requirePositive(i.amount, "amount must be greater than zero");
	if (i.mode && i.mode !== "Bank Transfer" && i.mode !== "UPI") refuse("mode must be Bank Transfer or UPI");
	const lc = cat.toLowerCase();
	if (lc === "cash to bank") { if (!i.toBankId) refuse("to bank is required"); return; }
	if (lc === "bank to cash") { if (!i.fromBankId) refuse("from bank is required"); return; }
	// any other category (bank to bank, or a lender repayment where no to-bank is needed): only the certain rule
	if (!i.fromBankId) refuse("from bank is required");
	if (i.toBankId && i.fromBankId === i.toBankId) refuse("from bank and to bank must be different");
}

export function checkExpense(i: ExpenseFormInput) {
	requirePositive(i.amount, "amount must be greater than zero");
	if (blank(i.category)) refuse("category is required");
	if (blank(i.mode) && !i.payments?.length) refuse("mode is required");
	// (no branch check: for a person tied to one branch the server fills the branch in itself)
	if (i.payments?.length) { checkParts(i.payments, i.amount); return; }
	const mode = i.mode === "Bank" ? "Bank Transfer" : i.mode;
	if (!MODES.includes(mode)) refuse("mode must be Cash, UPI or Bank Transfer");
	if (bankMode(mode) && !i.fromBankId) refuse("from bank is required when mode is UPI or Bank Transfer");
}

export function checkGoldSale(i: GoldSaleInput) {
	requirePositive(i.soldAmount, "sold amount must be greater than zero");
	requireNotNegative(i.costAmount, "cost amount must be zero or greater");
	// (no branch check: for a person tied to one branch the server fills the branch in itself)
	const mode = i.mode || "Cash";
	if (!MODES.includes(mode)) refuse("mode must be Cash, UPI or Bank Transfer");
	if (bankMode(mode) && !i.bankId) refuse("bank is required when mode is UPI or Bank Transfer");
	if (Number(i.costAmount) > 0) {
		const cm = i.costMode || "Cash";
		if (!MODES.includes(cm)) refuse("cost mode must be Cash, UPI or Bank Transfer");
		if (bankMode(cm) && !i.costBankId) refuse("cost bank is required");
	}
}

/* Name rules for a new cash source / cash-in category (and the name only for an expense category). */
export function checkCategoryName(name: string, noGoldSale = true) {
	const t = (name ?? "").trim();
	if (!t) refuse("name is required");
	if (noGoldSale && t.replace(/ /g, "").toLowerCase() === "goldsale") refuse("\"Gold Sale\" is a built-in source");
}

/* Cached expense, or null when this PC does not know it. */
export async function cachedExpense(id: number): Promise<{ status?: string; mode?: string; amount?: number; fromBankId?: number | null; branchId?: number } | null> {
	try {
		return (await apiFetchEnveloped<{ status?: string; mode?: string; amount?: number; fromBankId?: number | null; branchId?: number }>(`/expenses/${id}`)) ?? null;
	} catch {
		return null;
	}
}

export function requirePending(status?: string) {
	if (status && status !== "Pending") refuse("expense has already been approved or rejected", 409);
}
export function requireApproved(status: string | undefined, verb: "edited" | "deleted") {
	if (status && status !== "Approved") refuse(`only an approved expense can be ${verb}`, 409);
}

/* Server rule for a lender repayment: not more than what is still owed. `owed` = principal - drawn + repaid etc, from cached data. */
export function checkRepayCap(owed: number | undefined, amount: number, name: string) {
	if (typeof owed === "number" && amount > owed + 0.005) {
		refuse(`repayment exceeds the loan principal — only ₹${Math.max(owed, 0).toFixed(2)} is still owed on ${name}`);
	}
}
