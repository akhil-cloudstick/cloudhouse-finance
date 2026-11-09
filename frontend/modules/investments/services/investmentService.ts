import { apiFetchEnveloped as apiFetch, apiRawFetch, getAuthToken, ApiError, quietly } from "@/common/services/httpClient";
import { enqueueAndWait, newEntry, offlineReady } from "@/common/offline";
import { queueWrite } from "@/common/offline/queueWrite";
import { currentActor } from "@/common/offline/actor";
import { pendingInvestmentRow } from "@/common/offline/investmentAdjust";
import { PLAN_REF, createsInvestment, findLocalPlan, localRequestId } from "@/common/offline/requestRef";
import { dropUnsentRecord } from "@/common/offline/unsent";
import { assertPayoutFunds, partsOfSplit } from "@/common/offline/funds";
import { dayOf, recordList, refuse, requireNotBefore, requireNotFuture, requireNotNegative, requirePositive, requireValidSplit } from "@/common/offline/validate";
import { branchHeader } from "@/common/services/branchSelection";
import { printPdfJob } from "@/common/utils/print";
import { canMakeOffline, canRenderOffline, localPerson, renderAndPrint } from "@/common/offline/documents";
import { printTable, type ExportCell } from "@/common/offline/exports";
import { getBusinessProfile } from "@/modules/settings/services/businessProfileService";
import type { InvestmentStatus, BackendInvestmentPlan, CreatePlanInput, BackendInvestment, BackendInvestmentTransaction, BackendInvestmentPayout, CreateInvestmentInput, InvestmentLedgerRow, MaturityAction, AddCashInput, WithdrawInput } from "@/modules/investments/types/investment-types";

/* Desktop, server not answering: the plan goes into the outbox and is listed (and offered for a new investment) at once under
 * a local id (see common/offline/investmentAdjust.ts); it is sent when the connection is back, before any investment made with
 * it. Otherwise the plan is created on the server as before. */
export async function createInvestmentPlan(input: CreatePlanInput): Promise<BackendInvestmentPlan> {
	try {
		// quiet: with no answer the plan is queued below, so no "couldn't reach" pop-up is wanted
		return await quietly(() => apiFetch<BackendInvestmentPlan>("/investment-plans", { method: "POST", body: JSON.stringify(input) }));
	} catch (e) {
		if (!(offlineReady() && e instanceof ApiError && e.status === 0)) throw e;
		// the server's own plan checks (SaveInvestmentPlan)
		if (!["Schedule", "Live"].includes(input.engine ?? "Schedule")) refuse("engine must be Schedule or Live");
		if (input.productType && !["Deposit", "Bond"].includes(input.productType)) refuse("product type must be Deposit or Bond");
		requirePositive(input.tenureMonths, "tenure months must be greater than zero");
		if (!["Simple", "Compound"].includes(input.interestRateType)) refuse("interest rate type must be Simple or Compound");
		requireNotNegative(input.interestRatePercent, "interest rate percent must not be negative");
		if ((input.engine ?? "Schedule") === "Schedule") {
			const per = input.payoutFrequency === "Yearly" ? 12 : input.payoutFrequency === "Monthly" ? 1 : 0;
			if (per && input.tenureMonths % per !== 0) refuse("tenure months must divide evenly by the payout frequency");
		}
		const entry = newEntry("POST", "/investment-plans", input, currentActor());
		await enqueueAndWait(entry, () => undefined, () => undefined);
		return { id: localRequestId(entry.id), ...input } as BackendInvestmentPlan;
	}
}

export function updateInvestmentPlan(id: number, input: CreatePlanInput): Promise<BackendInvestmentPlan> {
	if (id < 0) throw new ApiError("This plan has not reached the server yet. Edit it once it has (it is sent as soon as the connection is back).", 409);
	const path = `/investment-plans/${id}`;
	// on the desktop the change is queued and the plan lists show it at once (see recordEdits.ts)
	return queueWrite("PUT", path, input, { id, ...input } as BackendInvestmentPlan, () =>
		apiFetch<BackendInvestmentPlan>(path, { method: "PUT", body: JSON.stringify(input) }));
}

// Refused by the server while any investment still uses the plan; offline the investments this PC holds are compared first.
export async function deleteInvestmentPlan(id: number): Promise<void> {
	const path = `/investment-plans/${id}/delete`;
	if (offlineReady() && id > 0) {
		let used: BackendInvestment[] = [];
		try {
			used = (await listInvestmentsPage({ page: 1, planIds: [String(id)], pageSize: 1000 })).items.filter((i) => i.planId === id);
		} catch {
			/* nothing held to compare with: the server decides */
		}
		if (used.length > 0) {
			refuse(`This plan is used by ${used.length} investment(s) (${recordList(used.map((i) => i.investmentNumber), used.length)}) and can't be deleted — mark it inactive instead.`, 409);
		}
	}
	await queueWrite("DELETE", path, undefined, undefined, async () => {
		await apiFetch<unknown>(path, { method: "DELETE" });
	});
}

/* activeOnly=true is what the New Investment picker uses (only plans still
 * open for new money) — the plan admin screen passes false to also show
 * retired plans, since existing investments still reference them. */
export function listInvestmentPlans(activeOnly?: boolean): Promise<BackendInvestmentPlan[]> {
	const qs = activeOnly ? "?activeOnly=true" : "";
	return apiFetch<BackendInvestmentPlan[]>(`/investment-plans${qs}`);
}

/* One page of plans (1-based), searched by name on the server — backs the Plan filter's scrolling list. */
export function searchInvestmentPlansPage(q: string, page: number, limit = 20): Promise<{ items: BackendInvestmentPlan[]; hasMore: boolean }> {
	const params = new URLSearchParams({ q, limit: String(limit), offset: String((page - 1) * limit) });
	return apiFetch<{ items: BackendInvestmentPlan[]; hasMore: boolean }>(`/investment-plans?${params}`);
}

/* What the form already knows that the server would otherwise work out, so the investment can be listed before it is sent. */
export type CreateInvestmentHint = { customerName: string; customerCode: string; plan: BackendInvestmentPlan };

/* Desktop: an investment for an investor this PC registered, or with a plan this PC made (neither numbered by the server yet),
 * goes straight into the outbox, and so does one made while the server does not answer. It is listed at once as PENDING and sent
 * when the connection is there, after the investor and the plan, which the entry points at by their uuid / plan ref. Otherwise
 * the investment is created on the server exactly as before, so its real number comes back. */
export async function createInvestment(input: CreateInvestmentInput, hint?: CreateInvestmentHint): Promise<BackendInvestment> {
	if (offlineReady() && hint && (typeof input.customerId === "string" || input.planId < 0)) return queueInvestment(input, hint);
	try {
		return await quietly(() => apiFetch<BackendInvestment>("/investments", { method: "POST", body: JSON.stringify(input) }));
	} catch (e) {
		if (offlineReady() && hint && e instanceof ApiError && e.status === 0) return queueInvestment(input, hint);
		throw e;
	}
}

async function queueInvestment(input: CreateInvestmentInput, hint: CreateInvestmentHint): Promise<BackendInvestment> {
	// the server's own checks (SaveInvestment), on the plan the form holds. The deposit is money coming IN, so no funds check applies.
	requirePositive(input.principalAmount, "principal amount must be greater than zero");
	if (hint.plan.isActive === false) refuse("investment plan is not active");
	if (Math.round(input.principalAmount * 100) / 100 < (hint.plan.minPrincipal || 0)) refuse("principal amount is below the plan's minimum");
	requireValidSplit(Math.round(input.principalAmount * 100) / 100, input);
	let planId: number | string = input.planId;
	if (input.planId < 0) {
		const found = await findLocalPlan(input.planId);
		if (!found) throw new ApiError("This plan is no longer on this PC. Pick the plan again.", 409);
		planId = "entryId" in found ? PLAN_REF + found.entryId : found.serverId;
	}
	// no targets: the sender copies a reply's id onto the record a target names, and the reply here is an investment
	const entry = newEntry("POST", "/investments", { ...input, planId }, currentActor());
	entry.view = { customerName: hint.customerName, customerCode: hint.customerCode, plan: hint.plan };
	await enqueueAndWait(entry, () => undefined, () => undefined);
	return pendingInvestmentRow(entry, input, entry.view as { customerName: string; customerCode: string; plan: BackendInvestmentPlan }) as unknown as BackendInvestment;
}

/* What this PC knows of an investment before it is changed: the investment and whether anything has been recorded on it (what is
 * still waiting to be sent counts too). null when nothing is held for it, and then the server decides. */
async function investmentState(id: number): Promise<{ inv: BackendInvestment; hasOps: boolean } | null> {
	try {
		const inv = await getInvestment(id);
		const tx = await getInvestmentTransactionsPage(id, 0);
		return { inv, hasOps: tx.items.length > 0 };
	} catch {
		return null;
	}
}

/* The server's reason an investment cannot be corrected (investmentEditBlocker). */
function investmentEditBlocker(inv: BackendInvestment, hasOps: boolean): string {
	if (inv.status !== "Active") return `an investment in status ${inv.status} cannot be edited`;
	if (inv.renewedToInvestmentId) return "it was renewed into another investment";
	if (inv.renewedFromInvestmentId) return "it was created by renewing another investment";
	if (hasOps || inv.totalInterestPaid > 0 || inv.interestWithdrawn > 0) return "interest, a payout, a top-up or a withdrawal has already been recorded — correct it from the ledger instead";
	return "";
}

/* Corrects an investment's plan, principal or start date — only before any interest, payout, top-up or withdrawal (the backend answers with the reason otherwise). On the
 * desktop with offline mode running the same reasons are given here, and the correction is queued. */
export async function editInvestment(id: number, input: Partial<CreateInvestmentInput> & { reason?: string }): Promise<BackendInvestment> {
	const path = `/investments/${id}`;
	const online = () => apiFetch<BackendInvestment>(path, { method: "PATCH", body: JSON.stringify(input) });
	if (!offlineReady()) return online();
	const state = id > 0 ? await investmentState(id) : null;
	if (state) {
		const reason = investmentEditBlocker(state.inv, state.hasOps);
		if (reason) refuse(`This investment cannot be edited — ${reason}.`, 409);
	}
	if (input.principalAmount !== undefined && !(input.principalAmount > 0)) refuse("principal amount must be greater than zero");
	if (input.startDate) requireNotFuture(input.startDate, "start date cannot be in the future");
	return queueWrite("PATCH", path, input, { ...(state?.inv ?? { id }), ...input } as BackendInvestment, online);
}

export const INVESTMENTS_TABLE_PAGE_SIZE = 10;

/* Paginated, searched, filtered list — backs the Investments list page.
 * `page` is 1-based; the backend responds with an {items, hasMore, total}
 * envelope (see backend/internal/investment/handler.go's List) — mirrors
 * personalLoanService.ts's listPersonalLoansPage exactly. */
export function listInvestmentsPage(params: {
	page: number;
	q?: string;
	status?: string; // "All", one status, or several joined by commas
	customerId?: number | string; // a string for an investor made on this PC and not sent yet ("uuid:...")
	customerIds?: string[]; // any of these investors
	planIds?: string[]; // any of these plans
	from?: string; // YYYY-MM-DD, bounds the start date (inclusive)
	to?: string; // YYYY-MM-DD, bounds the start date (inclusive)
	pageSize?: number;
}): Promise<{ items: BackendInvestment[]; hasMore: boolean; total: number }> {
	const pageSize = params.pageSize || INVESTMENTS_TABLE_PAGE_SIZE;
	const query = new URLSearchParams({
		limit: String(pageSize),
		offset: String((params.page - 1) * pageSize),
	});
	if (params.q) query.set("q", params.q);
	if (params.status && params.status !== "All") query.set("status", params.status);
	if (params.customerId) query.set("customerId", String(params.customerId));
	if (params.customerIds?.length) query.set("customerIds", params.customerIds.join(","));
	// Not in the contract's key table, so sent under the backend's own name.
	if (params.planIds?.length) query.set("plan_ids", params.planIds.join(","));
	if (params.from) query.set("from", params.from);
	if (params.to) query.set("to", params.to);
	return apiFetch<{ items: BackendInvestment[]; hasMore: boolean; total: number }>(`/investments?${query}`);
}

export function getInvestment(id: number): Promise<BackendInvestment> {
	return apiFetch<BackendInvestment>(`/investments/${id}`);
}

/* Resolves "INV-00003" to its numeric id — lets a ledger reference link to
 * #investment/INV-00003 (see LedgerRefLink's "investment" kind). */
export async function resolveInvestmentNumber(number: string): Promise<number> {
	return (await apiFetch<{ id: number }>(`/investments/by-number/${encodeURIComponent(number)}`)).id;
}

/* One server page of the ledger; `page` is 0-based like getInvestmentSchedulePage. */
export const INVESTMENT_LEDGER_PAGE_SIZE = 10;

export async function getInvestmentLedgerPage(id: number, page: number, pageSize: number = INVESTMENT_LEDGER_PAGE_SIZE): Promise<{ items: InvestmentLedgerRow[]; hasMore: boolean }> {
	const params = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize) });
	const res = await apiFetch<{ items: InvestmentLedgerRow[] | null; hasMore?: boolean }>(`/investments/${id}/ledger?${params}`);
	return { items: res.items || [], hasMore: !!res.hasMore };
}

export async function getInvestmentLedger(id: number): Promise<InvestmentLedgerRow[]> {
	return (await apiFetch<{ items: InvestmentLedgerRow[] | null }>(`/investments/${id}/ledger`)).items || [];
}

export const INVESTMENT_PAGE_SIZE = 20;

/* Unpaginated in practice (limit 20 comfortably covers a Monthly/12mo or
 * Yearly/multi-year schedule) — backs InvestmentDetail's schedule table.
 * `page` is 0-based, mirrors getPersonalLoanSchedulePage. */
export function getInvestmentSchedulePage(id: number, page: number, pageSize: number = INVESTMENT_PAGE_SIZE): Promise<{ items: BackendInvestmentPayout[]; hasMore: boolean }> {
	const params = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize) });
	return apiFetch<{ items: BackendInvestmentPayout[]; hasMore: boolean }>(`/investments/${id}/schedule?${params}`);
}

export function markPayoutPaid(
	investmentId: number,
	payoutId: number,
	split: { cashAmount: number; upiAmount: number; bankTransferAmount: number; chequeAmount: number },
	bankId?: number
): Promise<BackendInvestmentPayout> {
	const path = `/investments/${investmentId}/payouts/${payoutId}/pay`;
	const body = { ...split, bankId };
	return markPaidChecked(investmentId, payoutId, body).then(() => queueWrite("POST", path, body, { id: payoutId, status: "Paid" } as unknown as BackendInvestmentPayout, () =>
		apiFetch<BackendInvestmentPayout>(path, { method: "POST", body: JSON.stringify(body) })
	));
}

/* Offline only: runs a check before an entry is queued. Online the server does the checking. */
async function offlineCheck(check: () => Promise<void>): Promise<void> {
	if (offlineReady()) await check();
}

/* The investment as this PC shows it (it already counts the entries waiting to be sent); null when it cannot be read, and then nothing is blocked. */
async function readInvestment(id: number): Promise<BackendInvestment | null> {
	try {
		return await getInvestment(id);
	} catch {
		return null;
	}
}

async function markPaidChecked(investmentId: number, payoutId: number, split: { cashAmount: number; upiAmount: number; bankTransferAmount: number; chequeAmount: number; bankId?: number }): Promise<void> {
	await offlineCheck(async () => {
		const inv = await readInvestment(investmentId);
		if (inv && !["Active", "Matured", "Closed", "Renewed"].includes(inv.status)) refuse("investment is not active", 409);
		let payout: BackendInvestmentPayout | undefined;
		try {
			payout = (await getInvestmentSchedulePage(investmentId, 0, 1000)).items.find((p) => p.id === payoutId);
		} catch {
			payout = undefined;
		}
		if (payout?.status === "Paid") refuse("payout has already been paid", 409);
		if (payout) requireValidSplit(payout.amount, split);
	});
}

export async function matureInvestment(
	investmentId: number,
	input: { action: MaturityAction; planId?: number; principalAmount?: number; cashAmount?: number; upiAmount?: number; bankTransferAmount?: number; chequeAmount?: number; bankId?: number }
): Promise<BackendInvestment> {
	const path = `/investments/${investmentId}/mature`;
	await offlineCheck(async () => {
		if (input.action !== "Close" && input.action !== "Renew") refuse("maturity decision must be Close or Renew");
		const inv = await readInvestment(investmentId);
		if (!inv) return;
		if (inv.status !== "Matured") refuse("investment has not matured yet", 409);
		if (inv.engine === "Live" && input.action === "Close") {
			const total = Math.round(((inv.outstandingPrincipal || 0) + (inv.outstandingInterest || 0)) * 100) / 100;
			if (total > 0.005) {
				requireValidSplit(total, input);
				await assertPayoutFunds(inv.branchId, partsOfSplit(input));
			}
		}
	});
	return queueMature(path, investmentId, input);
}

function queueMature(path: string, investmentId: number, input: object): Promise<BackendInvestment> {
	return queueWrite("POST", path, input, undefined as unknown as BackendInvestment, () => apiFetch<BackendInvestment>(path, { method: "POST", body: JSON.stringify(input) })).then((r) => r ?? getInvestment(investmentId));
}

export function listInvestmentsForCustomer(customerId: number): Promise<BackendInvestment[]> {
	return apiFetch<BackendInvestment[]>(`/customers/${customerId}/investments`);
}

export async function addCashToInvestment(investmentId: number, input: AddCashInput): Promise<BackendInvestment> {
	const path = `/investments/${investmentId}/add-cash`;
	await offlineCheck(async () => {
		requirePositive(input.amount, "amount must be greater than zero");
		requireValidSplit(Math.round(input.amount * 100) / 100, input);
		const inv = await readInvestment(investmentId);
		if (!inv) return;
		if (inv.engine !== "Live") refuse("needs a live-accrual investment");
		if (inv.status !== "Active") refuse("investment is not active", 409);
		requireNotFuture(input.occurredOn, `date (${dayOf(input.occurredOn)}) cannot be in the future`);
		requireNotBefore(input.occurredOn, inv.lastAccrualDate, `date (${dayOf(input.occurredOn)}) is before the most recent recorded entry on this account (${dayOf(inv.lastAccrualDate)})`);
	});
	return queueWrite("POST", path, input, undefined as unknown as BackendInvestment, () =>
		apiFetch<BackendInvestment>(path, { method: "POST", body: JSON.stringify(input) })
	).then((r) => r ?? getInvestment(investmentId));
}

export async function withdrawFromInvestment(investmentId: number, input: WithdrawInput): Promise<BackendInvestment> {
	const path = `/investments/${investmentId}/withdraw`;
	await offlineCheck(async () => {
		if (input.interestAmount < 0 || input.principalAmount < 0) refuse("amount must be greater than zero");
		const total = Math.round((input.interestAmount + input.principalAmount) * 100) / 100;
		requirePositive(total, "amount must be greater than zero");
		requireValidSplit(total, input);
		const inv = await readInvestment(investmentId);
		if (!inv) return;
		if (inv.engine !== "Live") refuse("needs a live-accrual investment");
		if (inv.status !== "Active" && inv.status !== "Matured") refuse("investment is not active", 409);
		requireNotFuture(input.occurredOn, `date (${dayOf(input.occurredOn)}) cannot be in the future`);
		requireNotBefore(input.occurredOn, inv.lastAccrualDate, `date (${dayOf(input.occurredOn)}) is before the most recent recorded entry on this account (${dayOf(inv.lastAccrualDate)})`);
		if (input.principalAmount > inv.outstandingPrincipal + 0.01) refuse("withdrawal exceeds the outstanding principal", 409);
		// interest keeps accruing on the server, so a figure kept earlier can only be lower than the real one: blocks only when certain
		if (typeof inv.outstandingInterest === "number" && input.interestAmount > inv.outstandingInterest + 0.01 && !inv.lastAccrualDate) refuse("withdrawal exceeds the outstanding interest", 409);
	});
	return queueWrite("POST", path, input, undefined as unknown as BackendInvestment, () =>
		apiFetch<BackendInvestment>(path, { method: "POST", body: JSON.stringify(input) })
	).then((r) => r ?? getInvestment(investmentId));
}

export const INVESTMENT_TRANSACTIONS_PAGE_SIZE = 20;

/* `page` is 0-based, mirrors getInvestmentSchedulePage. */
export function getInvestmentTransactionsPage(
	investmentId: number,
	page: number
): Promise<{ items: BackendInvestmentTransaction[]; hasMore: boolean }> {
	const params = new URLSearchParams({
		limit: String(INVESTMENT_TRANSACTIONS_PAGE_SIZE),
		offset: String(page * INVESTMENT_TRANSACTIONS_PAGE_SIZE),
	});
	return apiFetch<{ items: BackendInvestmentTransaction[]; hasMore: boolean }>(`/investments/${investmentId}/transactions?${params}`);
}

/* Fetches a PDF blob at the given investment endpoint path — shared helper
 * behind fetchInvestmentBondPdf and fetchInvestmentStatementPdf below. */
async function fetchInvestmentPdf(investmentId: number, path: string): Promise<Blob> {
	const token = typeof window !== "undefined" ? getAuthToken() : null;
	const res = await apiRawFetch(`/investments/${investmentId}/${path}`, {
		headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...branchHeader() },
	});
	if (!res.ok) {
		let message = res.statusText;
		try {
			const body = await res.json();
			if (body?.error) message = body.error;
		} catch {
			/* non-JSON error body — fall back to statusText */
		}
		throw new ApiError(message, res.status);
	}
	return res.blob();
}

/* Fetches GET /investments/:id/bond/pdf as a blob — shared by
 * printInvestmentBondPdf and printInvestmentStatementPdf below (straight to
 * the print dialog), mirroring loanService.ts's downloadIndemnityBondPDF/
 * downloadReleaseAgreementPDF print flow. Available for every investment
 * regardless of ProductType. */
async function fetchInvestmentBondPdf(investmentId: number): Promise<Blob> {
	return fetchInvestmentPdf(investmentId, "bond/pdf");
}

/* Fetches GET /investments/:id/statement/pdf as a blob — the investor
 * account statement (terms + full transaction/payout history). */
async function fetchInvestmentStatementPdf(investmentId: number): Promise<Blob> {
	return fetchInvestmentPdf(investmentId, "statement/pdf");
}

/* Sends the Debenture Subscription Agreement straight to the browser's
 * print dialog — same printPdfBlob flow as loanService.ts's
 * downloadIndemnityBondPDF/downloadReleaseAgreementPDF. */
async function investmentBondHere(investmentId: number): Promise<void> {
	const investment = await getInvestment(investmentId);
	const profile = await getBusinessProfile().catch(() => null);
	return renderAndPrint("investment-bond", "en", { investment, person: localPerson(investment.customerId as number), profile: profile ?? {} });
}

export async function printInvestmentBondPdf(investmentId: number): Promise<void> {
	// an investment made on this PC and not sent yet is on no server: its bond is made here, whether or not the server answers
	if (investmentId <= 0 && canRenderOffline()) return investmentBondHere(investmentId);
	try {
		return await printPdfJob(() => fetchInvestmentBondPdf(investmentId), undefined, `investment-bond-${investmentId}.pdf`);
	} catch (e) {
		if (!canMakeOffline(e)) throw e;
		// the server did not answer: the bond is made on this PC from the investment and investor it holds
		return investmentBondHere(investmentId);
	}
}

/* Sends the investment's account statement straight to the browser's print
 * dialog — same printPdfBlob flow as printInvestmentBondPdf above. */
export async function printInvestmentStatementPdf(investmentId: number): Promise<void> {
	// an investment made on this PC and not sent yet is on no server: its statement is made here, whether or not the server answers
	if (investmentId <= 0 && canRenderOffline()) return investmentStatementHere(investmentId);
	try {
		return await printPdfJob(() => fetchInvestmentStatementPdf(investmentId), undefined, `investment-statement-${investmentId}.pdf`);
	} catch (e) {
		if (!canMakeOffline(e)) throw e;
		return investmentStatementHere(investmentId);
	}
}

/* The statement made on this PC from the investment, its ledger and schedule that it holds. */
async function investmentStatementHere(investmentId: number): Promise<void> {
	const inv = await getInvestment(investmentId);
	const ledger = await getInvestmentLedger(investmentId).catch(() => [] as InvestmentLedgerRow[]);
	const sched = await getInvestmentSchedulePage(investmentId, 0, 500).then((r) => r.items).catch(() => [] as BackendInvestmentPayout[]);
	const dmy = (s: string | null | undefined) => (s || "").slice(0, 10);
	const summary = [
		`Investment: ${inv.investmentNumber}`,
		`Investor: ${inv.customer?.name ?? ""} (${inv.customer?.code ?? ""})`,
		`Plan: ${inv.plan?.name ?? ""} - ${inv.interestRatePercent}% ${inv.interestRateType}, ${inv.payoutFrequency}, ${inv.tenureMonths} months`,
		`Principal: ${inv.principalAmount}`,
		`Start: ${dmy(inv.startDate)}  Maturity: ${dmy(inv.maturityDate)}  Status: ${inv.status}`,
		`Total interest paid: ${inv.totalInterestPaid}`,
	];
	const rows: ExportCell[][] = ledger.map((r) => [dmy(r.date), r.description, r.method, r.reference, r.debitOrCredit === "debit" ? r.amount : "", r.debitOrCredit === "credit" ? r.amount : "", r.runningBalance]);
	if (sched.length) {
		rows.push(["", "Payout schedule", "", "", "", "", ""]);
		for (const p of sched) rows.push([dmy(p.dueDate), p.isPrincipalReturn ? "Principal return" : "Interest payout", p.status, p.paidAt ? `paid ${dmy(p.paidAt)}` : "", "", p.amount, ""]);
	}
	return printTable({ title: "Investment Statement", filename: `investment-statement-${inv.investmentNumber}`, summary, headers: ["Date", "Description", "Mode / Status", "Reference", "Debit", "Credit", "Balance"], rows });
}


/* The unpaid interest months of a scheduled investment, oldest first. */
export async function getPendingInterest(investmentId: number): Promise<BackendInvestmentPayout[]> {
	return (await apiFetch<{ items: BackendInvestmentPayout[] | null }>(`/investments/${investmentId}/pending-interest`)).items || [];
}

/* Pays several months of interest together: the amount is applied to the oldest unpaid months in order, and the
 * payment breakdown (mode split + bank) is spread over them. The amount must be a whole number of months. */
export async function payInterestMonths(
	investmentId: number,
	input: { amount: number; cashAmount: number; upiAmount: number; bankTransferAmount: number; chequeAmount: number; bankId?: number }
): Promise<BackendInvestmentPayout[]> {
	const path = `/investments/${investmentId}/pay-interest`;
	await offlineCheck(async () => {
		const amount = Math.round(input.amount * 100) / 100;
		requirePositive(amount, "amount must be greater than zero");
		const inv = await readInvestment(investmentId);
		if (inv && inv.engine === "Live") refuse("no payout schedule for this investment");
		if (inv && !["Active", "Matured", "Closed", "Renewed"].includes(inv.status)) refuse("investment is not active", 409);
		requireValidSplit(amount, input);
		let pending: BackendInvestmentPayout[] | null = null;
		try {
			pending = await getPendingInterest(investmentId);
		} catch {
			pending = null;
		}
		if (pending) {
			if (pending.length === 0) refuse("there is no unpaid interest on this investment", 409);
			let covered = 0;
			let months = 0;
			for (const p of pending) {
				if (covered + p.amount > amount + 0.01) break;
				covered = Math.round((covered + p.amount) * 100) / 100;
				months++;
			}
			if (months === 0) refuse(`amount is less than the next month's interest of ₹${pending[0].amount.toFixed(2)}`);
			if (Math.abs(covered - amount) > 0.01) {
				let msg = `amount must cover whole months — ₹${covered.toFixed(2)} covers ${months} month(s)`;
				if (months < pending.length) msg += `, ₹${(Math.round((covered + pending[months].amount) * 100) / 100).toFixed(2)} covers ${months + 1}`;
				refuse(msg);
			}
		}
		await assertPayoutFunds(inv?.branchId, partsOfSplit(input));
	});
	return queueWrite("POST", path, input, [] as BackendInvestmentPayout[], async () => {
		const res = await apiFetch<{ items: BackendInvestmentPayout[] | null }>(path, { method: "POST", body: JSON.stringify(input) });
		return res.items || [];
	});
}

/* --- Ledger entry edit / delete ---
 * The investment is recalculated server-side in one transaction. dryRun asks for the before/after figures
 * without saving anything. entryId is the ledger row id ("tx-5", "payout-3", "open-7"). */
export type InvestmentLedgerSummary = {
	invested: number;
	outstandingPrincipal: number;
	outstandingInterest: number;
	totalInterestPaid: number;
	paidPayouts: number;
	status: string;
	startDate: string;
	maturityDate: string;
};
export type InvestmentLedgerEditPreview = { before: InvestmentLedgerSummary; after: InvestmentLedgerSummary; dryRun: boolean };
export type EditInvestmentLedgerInput = {
	occurredOn?: string;
	amount?: number; // opening / add-cash deposit
	principalAmount?: number; // withdrawal
	interestAmount?: number; // withdrawal
	cashAmount?: number;
	upiAmount?: number;
	bankTransferAmount?: number;
	chequeAmount?: number;
	bankId?: number;
	reference?: string;
	reason?: string;
};

export function editInvestmentLedgerEntry(investmentId: number, entryId: string, input: EditInvestmentLedgerInput, dryRun = false): Promise<InvestmentLedgerEditPreview> {
	const path = `/investments/${investmentId}/ledger/${encodeURIComponent(entryId)}`;
	if (dryRun) return apiFetch<InvestmentLedgerEditPreview>(`${path}?dry_run=true`, { method: "PATCH", body: JSON.stringify(input) });
	return queueWrite("PATCH", path, input, { dryRun: false } as InvestmentLedgerEditPreview, () =>
		apiFetch<InvestmentLedgerEditPreview>(path, { method: "PATCH", body: JSON.stringify(input) })
	);
}

export function deleteInvestmentLedgerEntry(investmentId: number, entryId: string, dryRun = false, reason?: string): Promise<InvestmentLedgerEditPreview> {
	const path = `/investments/${investmentId}/ledger/${encodeURIComponent(entryId)}`;
	const qs = new URLSearchParams({ ...(reason ? { reason } : {}), ...(dryRun ? { dry_run: "true" } : {}) });
	if (dryRun) return apiFetch<InvestmentLedgerEditPreview>(`${path}?${qs}`, { method: "DELETE" });
	return queueWrite("DELETE", reason ? `${path}?${qs}` : path, undefined, { dryRun: false } as InvestmentLedgerEditPreview, () =>
		apiFetch<InvestmentLedgerEditPreview>(`${path}?${qs}`, { method: "DELETE" })
	);
}

/* Closes an active/matured investment that owes the investor nothing more (every payout paid, principal paid
 * back) — no cash moves. The backend refuses with what is still owed otherwise. */
export function closeInvestment(investmentId: number): Promise<BackendInvestment> {
	const path = `/investments/${investmentId}/close`;
	return queueWrite("POST", path, undefined, undefined as unknown as BackendInvestment, () => apiFetch<BackendInvestment>(path, { method: "POST" })).then((r) => r ?? getInvestment(investmentId));
}

/* Deletes an investment at any stage, reversing every cash entry it booked, in one transaction server-side.
 * Needs the "can delete investment" permission. */
export async function deleteInvestment(investmentId: number): Promise<void> {
	// one made on this PC and not sent yet: nothing is on the server, so deleting it takes back the entry that creates it (and what was done to it since)
	if (investmentId < 0 && offlineReady()) {
		if (await dropUnsentRecord(investmentId, createsInvestment)) return;
		throw new ApiError("This investment was sent while you were deleting it. Refresh, then delete it.", 409);
	}
	const path = `/investments/${investmentId}/delete`;
	if (offlineReady()) {
		const state = await investmentState(investmentId);
		// the server's investmentDeleteBlocker
		if (state?.inv.renewedToInvestmentId) refuse("This investment cannot be deleted — it was renewed into another investment — delete that one first.", 409);
	}
	await queueWrite("DELETE", path, undefined, undefined, async () => {
		await apiFetch<unknown>(path, { method: "DELETE" });
	});
}
