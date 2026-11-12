import { apiFetchEnveloped as apiFetch, apiRawFetch, getAuthToken, ApiError } from "@/common/services/httpClient";
import { branchHeader } from "@/common/services/branchSelection";
import { isSmallScreen } from "@/common/utils/responsive";
import { offlineStore } from "@/common/services/desktopBridge";
import { localPledgeId } from "@/common/offline/pledgeRef";
import { findLocalRequest, localRequestId } from "@/common/offline/requestRef";
import { canQueue, queueOnly, queueWrite, settleSend } from "@/common/offline/queueWrite";
import { setAuctionStage } from "@/common/offline/auctionStages";
import { loanChangesReplayable } from "@/common/offline/localApi";
import { assertPayoutFunds, partsOfSplit } from "@/common/offline/funds";
import { releaseAmountNeeded } from "@/modules/loans/utils/releaseAmount";
import { changeWithEntry, enqueueAndWait, getLocal, newEntry, offlineReady, removeLocal, upsertLocal, type LocalRecord, type OutboxEntry } from "@/common/offline";
import { enabledStages, fetchApprovalWorkflow, isFlowOff, nextStage, stageByPending } from "@/common/services/approvalWorkflowService";
import {
  applyActionLocally,
  applyEditLocally,
  applyPaymentLocally,
  buildOptimisticLoan,
  currentActor,
  filterLocalLoans,
  localLoanByKey,
  localLoanByNumericId,
  localLoans,
  pendingKey,
  reversePaymentLocally,
  checkAuctionStepLocally,
  saveOptimisticLoan,
  sortNewestFirst,
  type CreateLoanHint,
  type EditSchemeTerms,
  checkCreateLoanLocally, checkApprovalLocally, checkPaymentLocally, checkTopUpLocally, checkBankPledgeLocally, canTakeBankPledge, checkRequestLocally, checkOrnamentLocally,
} from "@/modules/loans/services/loanOffline";
import { listSchemes } from "@/modules/schemes/services/schemeService";
import type { SchemeView } from "@/modules/schemes/types/scheme-types";
import { printPdfJob } from "@/common/utils/print";
import { canMakeOffline, canRenderOffline, printOfflineBondPreview, printOfflineLoanDocument, printOfflinePartialReceipt, renderOfflineLoanDocument } from "@/modules/loans/services/loanDocumentsOffline";
import { roundRupee } from "@/common/utils/format";
import type { BondLang } from "@/modules/loans/utils/indemnityBond";
import type { OrnamentRequestInput, CreateLoanInput, BackendOrnament, BackendLoanPayment, BackendBankPledgeRecord, BackendLoan, OrnamentView, PaymentView, BankPledgeView, LoanView, BackendCustomerOrnamentRow, CustomerOrnamentRowView, BackendCustomerPaymentRow, CustomerPaymentRowView, BackendCustomerBankPledgeRow, CustomerBankPledgeRowView, SaveDraftInput, BackendLoanDraft, IndemnityBondEsignStart, EsignWitnessInput, IndemnityBondDeliverBy, IndemnityBondEsignCheck, LoanFilters, PurityTestInput, SanctionStage, ApprovalStageRecord, ApprovalInput, UpdateLoanInput, PaymentInput, TopUpInput, LoanTopUpView, TopUpApprovalInput, BankPledgeInput, BankPledgeCashTreatment, BankPledgeRecordView, AuctionStage, AuctionSettlementStatus, AuctionSurplusDisposition, AuctionDecisionStatus, AuctionDecisionRequestView, AuctionRecordView, BackendAuctionDecisionRequest, BackendAuctionRecord, BackendCustomerAuctionRow, CustomerAuctionRowView, BackendConcludedAuctionRow, ConcludedAuctionRowView, LoanLedgerEntry, LoanLedgerPage, LoanLedgerQuery, BackendLoanLedgerEntry, BackendLoanRequest, RequestView, LoanRequestFilters, LoanRiskLevel, LoanRiskRow, LoanRiskCounts, ChecklistInput, ReleasePaymentInput, ReleaseApprovalInput, ExtensionApprovalInput, IndemnityBondPreviewInput } from "@/modules/loans/types/loan-types";

function toOrnamentView(o: BackendOrnament): OrnamentView {
  return {
    id: o.id,
    name: o.name,
    purity: o.purity,
    grossWeight: o.grossWeight,
    netWeight: o.netWeight,
    quantity: o.quantity,
    goldValue: o.goldValue,
    remarks: o.remarks,
    photoUrl: o.images && o.images.length ? o.images[0].imageUrl : undefined,
    photoUrls: (o.images || []).map((im) => im.imageUrl),
    releasedAt: o.releasedAt ?? null,
  };
}

function toPaymentView(p: BackendLoanPayment): PaymentView {
  return {
    id: p.id,
    amount: p.amount,
    type: p.type,
    processingFee: p.processingFee,
    processingFeeApplied: p.processingFeeApplied,
    paidOn: p.paidOn.slice(0, 10),
    receivedByEmployeeId: p.receivedByEmployeeId,
    description: p.description,
    discountKind: p.discountKind,
    linkedPaymentId: p.linkedPaymentId,
    method: p.method,
    cashAmount: p.cashAmount,
    upiAmount: p.upiAmount,
    bankTransferAmount: p.bankTransferAmount,
    chequeAmount: p.chequeAmount,
    reference: p.reference,
    penalInterestApplied: p.penalInterestApplied,
    interestApplied: p.interestApplied,
    principalApplied: p.principalApplied,
    runningBalance: p.runningBalance,
    cashTransactionGroupId: p.cashTransactionGroupId,
    bankId: p.bankId,
    bankName: p.bankRef?.name,
  };
}

function toBankPledgeView(p: BackendBankPledgeRecord): BankPledgeView {
  return {
    id: p.id,
    bankId: p.bankId,
    bankName: p.bankName,
    pledgedAmount: p.pledgedAmount,
    pledgeDate: p.pledgeDate.slice(0, 10),
    releaseDate: p.releaseDate ? p.releaseDate.slice(0, 10) : null,
    bankPledgeDueDate: p.bankPledgeDueDate ? p.bankPledgeDueDate.slice(0, 10) : null,
    pledgedGrossWeight: p.pledgedGrossWeight,
    pledgedNetWeight: p.pledgedNetWeight,
    isReleased: !!p.releaseDate,
    ornamentIds: p.ornamentIds || [],
    bankInterestRate: p.bankInterestRate,
    referenceNumber: p.referenceNumber,
    // Rows predating the cash-treatment field default to CashIn, which is what
    // they genuinely did — unconditional cash-in was the only behavior that
    // existed before. Defaulting to RecordOnly here would misreport history and
    // suppress the cash-out that releasing such a pledge needs.
    cashTreatment: p.cashTreatment || "CashIn",
    status: p.status || (p.releaseDate ? "Released" : "Active"),
    voidReason: p.voidReason || "",
    cashAmount: p.cashAmount ?? 0,
    upiAmount: p.upiAmount ?? 0,
    bankTransferAmount: p.bankTransferAmount ?? 0,
    receivedBankId: p.receivedBankId ?? null,
    releaseCashAmount: p.releaseCashAmount ?? 0,
    releaseUpiAmount: p.releaseUpiAmount ?? 0,
    releaseBankTransferAmount: p.releaseBankTransferAmount ?? 0,
    releaseBankId: p.releaseBankId ?? null,
  };
}
export function toCustomerOrnamentRowView(o: BackendCustomerOrnamentRow): CustomerOrnamentRowView {
  return { ...toOrnamentView(o), loanId: o.loanId, loanNumber: o.loanNumber };
}
export function toCustomerPaymentRowView(p: BackendCustomerPaymentRow): CustomerPaymentRowView {
  return { ...toPaymentView(p), loanId: p.loanId, loanNumber: p.loanNumber };
}
export function toCustomerBankPledgeRowView(p: BackendCustomerBankPledgeRow): CustomerBankPledgeRowView {
  return { ...toBankPledgeView(p), loanId: p.loanId, loanNumber: p.loanNumber };
}

/** The calendar day (YYYY-MM-DD) an ISO timestamp falls on in the viewer's timezone. */
function localDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toView(l: BackendLoan): LoanView {
  return {
    id: l.loanNumber || (l.uuid ? pendingKey(l.uuid) : ""),
    numericId: l.id || 0,
    uuid: l.uuid || "",
    loanNumber: l.loanNumber || "",
    branchId: l.branchId,
    branchName: l.branch?.name || "—",
    customerId: String(l.customerId),
    customerName: l.customer?.name || "—",
    customerCode: l.customer?.code || "",
    schemeId: String(l.schemeId),
    schemeName: l.scheme?.name || "—",
    schemeRate: l.schemeInterestRate || 0,
    schemeLtv: l.schemeLtvPercent || 0,
    schemeMethod: l.schemeInterestMethod || "—",
    schemePenal: l.schemePenalRate || 0,
    opened: l.openedDate ? l.openedDate.slice(0, 10) : "",
    due: l.dueDate ? l.dueDate.slice(0, 10) : "",
    // The closing moment is a timestamp; show the calendar day the user saw, not its UTC day.
    closed: l.closedAt ? localDay(l.closedAt) : "",
    additionalInfo: l.additionalInfo || "",
    overallPhotoUrl: l.overallPhotoUrl || "",
    totalNetWeight: l.totalNetWeight,
    totalGoldValue: l.totalGoldValue,
    eligibleLoanAmount: l.eligibleLoanAmount,
    principal: l.principalAmount,
    outstanding: l.outstandingAmount,
    // saved interest plus the days since the last charge, which the backend adds to the outstanding figure
    accruedInterest: Math.max(l.accruedInterest, l.outstandingInterest + l.interestPaid),
    interestPaid: l.interestPaid,
    accruedPenalInterest: l.accruedPenalInterest,
    penalInterestPaid: l.penalInterestPaid,
    outstandingInterest: l.outstandingInterest,
    outstandingPenalInterest: l.outstandingPenalInterest,
    outstandingProcessingFee: l.outstandingProcessingFee,
    totalOutstandingBalance: l.totalOutstandingBalance,
    settlementAmount: l.settlementAmount,
    totalPaid: l.totalPaid,
    status: l.status,
    approvalStage: l.approvalStage,
    sanctionedAmount: l.sanctionedAmount || 0,
    disbursedAmount: l.disbursedAmount || 0,
    serviceChargeMode: l.serviceChargeMode || "",
    serviceChargeAmount: l.serviceChargeAmount || 0,
    serviceChargeType: l.serviceChargeType,
    serviceChargeValue: l.serviceChargeValue,
    disbursementDate: l.disbursementDate ? l.disbursementDate.slice(0, 10) : null,
    bankPledgeStatus: l.bankPledgeStatus,
    isDueSoon: l.isDueSoon,
    isOverdue: l.isOverdue,
    isDefaulted: l.isDefaulted,
    daysOverdue: l.daysOverdue,
    approvalWarning: l.approvalWarning || "",
    rejectedByName: l.rejectedByName || "",
    rejectedAt: l.rejectedAt || null,
    rejectionRemarks: l.rejectionRemarks || "",
    auctionDate: l.auctionDate ? l.auctionDate.slice(0, 10) : null,
    auctionAmount: l.auctionAmount ?? null,
    indemnityBondSignStatus: l.indemnityBondSignStatus || "",
    indemnityBondSignedUrl: l.indemnityBondSignedUrl || "",
    indemnityBondSignedAt: l.indemnityBondSignedAt ? l.indemnityBondSignedAt.slice(0, 10) : null,
    pledgeSlipSignStatus: l.pledgeSlipSignStatus || "",
    pledgeSlipSignedUrl: l.pledgeSlipSignedUrl || "",
    ornaments: (l.ornaments || []).map(toOrnamentView),
    payments: (l.payments || []).map(toPaymentView),
    bankPledges: (l.bankPledges || []).map(toBankPledgeView),
  };
}

/* Creates a loan with its ornaments in one call. The backend creates
 * ornaments in the same order they're submitted and (per
 * internal/loan/repository.go's OrnamentRepository.FindByLoanID, which
 * orders "id asc") returns them back in that same order, so callers may
 * zip the input rows with `ornaments` in the response by array index. */
export async function createLoan(input: CreateLoanInput, hint?: CreateLoanHint): Promise<BackendLoan> {
  if (!offlineReady() || !hint) {
    return apiFetch<BackendLoan>("/loans", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
  checkCreateLoanLocally(input, hint);
  // Desktop: the save goes into the outbox first, with the local copy updated in the same step. If the server
  // answers within a few seconds the real loan comes back exactly as online; otherwise the loan shows with a
  // PENDING number and is sent by the cron.
  const entry = newEntry("POST", "/loans", input, currentActor());
  entry.targets = [entry.id];
  const draft = { ...buildOptimisticLoan(entry.id, input, hint), uuid: entry.id };
  const outcome = await enqueueAndWait(
    entry,
    () => saveOptimisticLoan(draft),
    () => removeLocal("loans", entry.id),
  );
  const saved = getLocal("loans", entry.id) as unknown as BackendLoan | undefined;
  if (saved) return saved;
  if (outcome === "sent") throw new ApiError("The loan was saved but could not be read back. Refresh the list.", 0);
  return draft;
}
export type { CreateLoanHint };

export async function saveDraft(input: SaveDraftInput): Promise<BackendLoanDraft> {
  if (canQueue()) return queueOnly("POST", "/loans/drafts", input, { id: 0, ...input } as unknown as BackendLoanDraft);
  return apiFetch<BackendLoanDraft>("/loans/drafts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/* Overwrites an existing draft — pressing "Save Draft" again in the same
 * sitting updates it in place rather than piling up near-duplicates. */
export async function updateDraft(draftId: number, input: SaveDraftInput): Promise<BackendLoanDraft> {
  if (canQueue()) return queueOnly("PUT", `/loans/drafts/${draftId}`, input, { id: draftId, ...input } as unknown as BackendLoanDraft);
  return apiFetch<BackendLoanDraft>(`/loans/drafts/${draftId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/* The caller's own drafts, most recently saved first. */
export async function listDrafts(): Promise<BackendLoanDraft[]> {
  const rec = await apiFetch<BackendLoanDraft[]>("/loans/drafts");
  return rec || [];
}

export async function getDraft(draftId: number): Promise<BackendLoanDraft> {
  return apiFetch<BackendLoanDraft>(`/loans/drafts/${draftId}`);
}

export async function deleteDraft(draftId: number): Promise<void> {
  if (canQueue()) {
    await queueOnly("DELETE", `/loans/drafts/${draftId}`, undefined, undefined);
    return;
  }
  await apiFetch<void>(`/loans/drafts/${draftId}`, { method: "DELETE" });
}

/* Attaches one photo to an already-created ornament. */
export async function addOrnamentImage(ornamentId: number, imageUrl: string): Promise<unknown> {
  if (offlineReady() && ornamentId > 0) {
    await queueRawIfUnreachable(OFFLINE_FIRST, "POST", `/loans/ornaments/${ornamentId}/images`, { imageUrl });
    return undefined;
  }
  try {
    return await apiFetch(`/loans/ornaments/${ornamentId}/images`, {
      method: "POST",
      body: JSON.stringify({ imageUrl }),
    });
  } catch (e) {
    if (ornamentId > 0 && (await queueRawIfUnreachable(e, "POST", `/loans/ornaments/${ornamentId}/images`, { imageUrl }))) return undefined;
    throw e;
  }
}

export async function startIndemnityBondEsign(
  loanId: number,
  // BondLang, not a second inline union: the two drifted apart when
  // Gujarati was added, and the whole point of the shared type is that a
  // new language is one edit.
  lang: BondLang,
  redirectUrl: string,
  deliverBy: IndemnityBondDeliverBy = "open",
  witnesses?: EsignWitnessInput[]
): Promise<IndemnityBondEsignStart> {
  return apiFetch<IndemnityBondEsignStart>(`/loans/${loanId}/indemnity-bond/esign/start`, {
    method: "POST",
    body: JSON.stringify({ lang, redirectUrl, deliverBy, ...(witnesses?.length ? { witnesses } : {}) }),
  });
}

/* Polls the outstanding Setu signature request started by
 * startIndemnityBondEsign. Returns the current status while the customer
 * hasn't finished signing yet (poll again later), or the updated loan
 * (carrying indemnityBondSignedUrl) once "sign_complete". */
export async function checkIndemnityBondEsign(loanId: number): Promise<IndemnityBondEsignCheck> {
  return apiFetch<IndemnityBondEsignCheck>(`/loans/${loanId}/indemnity-bond/esign/status`);
}

/* Sends the GML pledge slip to the customer for Aadhaar eSign — the customer is
 * the only signer. Shares the bond's endpoints, selected by `document: "slip"`. */
export async function startPledgeSlipEsign(
  loanId: number,
  redirectUrl: string,
  deliverBy: IndemnityBondDeliverBy = "open"
): Promise<IndemnityBondEsignStart> {
  return apiFetch<IndemnityBondEsignStart>(`/loans/${loanId}/indemnity-bond/esign/start`, {
    method: "POST",
    body: JSON.stringify({ document: "slip", redirectUrl, deliverBy }),
  });
}

export async function checkPledgeSlipEsign(loanId: number): Promise<IndemnityBondEsignCheck> {
  return apiFetch<IndemnityBondEsignCheck>(`/loans/${loanId}/indemnity-bond/esign/status?document=slip`);
}

const csv = (v: string | number | (string | number)[]) => (Array.isArray(v) ? v.join(",") : String(v));
const hasValue = (v?: string | number | (string | number)[]) => (Array.isArray(v) ? v.length > 0 : !!v);

/* On the desktop, a read the server did not answer at all is answered from the local copy, which also
 * holds loans made on this PC that the server has not numbered yet. An answer from the server, even an
 * error, is never replaced. */
/* A save that has no local picture to update (a request, a bank re-pledge): with offline mode on it goes into the outbox
 * first, addressed by the loan's UUID, and the sender posts it from there. Returns the local loan so the screen can
 * carry on; what the entry changes appears once it has been sent. Returns null when this is not the desktop, or the
 * loan is not known on this PC, so the caller makes the request as usual. */
async function queueFirst(
  loanId: number,
  suffix: string,
  method: "POST" | "PUT",
  body: unknown,
  effect?: (loan: BackendLoan, entryId: string) => BackendLoan,
  view?: Record<string, unknown>,
): Promise<BackendLoan | null> {
  if (!offlineReady()) return null;
  // a loan made on this PC that the server has not numbered yet has no id for the server's own records (requests, pledges)
  // to point at, so this has to wait for the send instead of failing as "couldn't connect"
  if (!loanId) throw new ApiError(NOT_SENT, 409);
  const rec = localLoanByNumericId(loanId);
  if (!rec?.uuid) return null;
  const entry = newEntry(method, `/loans/uuid:${rec.uuid}${suffix}`, body, currentActor(), [rec.uuid]);
  if (view) entry.view = view;
  // an optional change to the loan's own local copy, so the screens show the result before the server has it
  const after = effect ? ({ ...effect(rec as unknown as BackendLoan, entry.id), uuid: rec.uuid } as BackendLoan & { uuid: string }) : null;
  await enqueueAndWait(entry, () => (after ? upsertLocal("loans", after as unknown as LocalRecord) : undefined), () => undefined);
  return (after ?? rec) as unknown as BackendLoan;
}

const NOT_SENT = "Loan not sycned.";
const NOT_SYNCED = "Loan not synced.";

/* A change that has no local picture to update beyond the loan itself: sent as usual, and only when the server does
 * not answer at all it is kept in the outbox and sent later. Ornament changes address the ornament by its server id,
 * so they need the loan to be on the server already; the loan is shown as it was until the entry has been sent. */
async function queueRawIfUnreachable(e: unknown, method: "POST" | "PUT" | "DELETE", path: string, body: unknown, loanId?: number): Promise<boolean> {
  if (!offlineReady() || !(e instanceof ApiError) || e.status !== 0) return false;
  const rec = loanId ? localLoanByNumericId(loanId) : undefined;
  const entry = newEntry(method, path, body, currentActor(), rec?.uuid ? [rec.uuid] : []);
  await enqueueAndWait(entry, () => undefined, () => undefined);
  await settleSend(); // no local picture to show: let the send and the pull land first so the reloaded loan is current
  return true;
}

// Offline mode running: these changes go to the outbox first, the same path as when the server does not answer.
const OFFLINE_FIRST = new ApiError("", 0);

async function orLocal<T>(live: () => Promise<T>, local: () => T): Promise<T> {
  try {
    return await live();
  } catch (e) {
    if (offlineReady() && e instanceof ApiError && e.status === 0) return local();
    throw e;
  }
}

export async function listLoans(filters?: LoanFilters): Promise<LoanView[]> {
  return orLocal(
    () => listLoansLive(filters),
    () => sortNewestFirst(filterLocalLoans(localLoans(), filters)).map(toView),
  );
}

async function listLoansLive(filters?: LoanFilters): Promise<LoanView[]> {
  const params = new URLSearchParams();
  if (filters?.q) params.set("q", filters.q);
  if (filters && hasValue(filters.status)) params.set("status", csv(filters.status!));
  if (filters && hasValue(filters.branchId)) params.set("branchId", csv(filters.branchId!));
  if (filters && hasValue(filters.customerId)) params.set("customerId", csv(filters.customerId!));
  if (hasValue(filters?.schemeId)) params.set("schemeId", csv(filters!.schemeId!));
  if (filters && hasValue(filters.auctionStage)) params.set("auctionStage", csv(filters.auctionStage!));
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  const qs = params.toString();
  const rec = await apiFetch<BackendLoan[]>(`/loans${qs ? `?${qs}` : ""}`);
  return (rec || []).map(toView);
}

/* Page size for the Loans page's own table (distinct from LOAN_PAGE_SIZE,
 * which backs the SearchableSelect picker's infinite scroll). */
export const LOANS_TABLE_PAGE_SIZE = 10;
export function getLoansPageSize() {
  return isSmallScreen() ? 7 : 10;
}

/* Paginated variant of listLoans for the Loans page table — same {items,
 * hasMore} envelope as searchLoansPage, but keyed off the page's own filters
 * (status/q) rather than a picker's free-text query. */
export async function listLoansPage(
  filters: LoanFilters & { page: number; limit?: number }
): Promise<{ items: LoanView[]; hasMore: boolean; total: number }> {
  const pageSize = filters.limit ?? getLoansPageSize();
  return orLocal(
    () => listLoansPageLive(filters, pageSize),
    () => {
      const all = sortNewestFirst(filterLocalLoans(localLoans(), filters));
      const from = (filters.page - 1) * pageSize;
      return { items: all.slice(from, from + pageSize).map(toView), hasMore: from + pageSize < all.length, total: all.length };
    },
  );
}

async function listLoansPageLive(
  filters: LoanFilters & { page: number; limit?: number },
  pageSize: number,
): Promise<{ items: LoanView[]; hasMore: boolean; total: number }> {
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String((filters.page - 1) * pageSize),
  });
  if (filters.q) params.set("q", filters.q);
  if (hasValue(filters.status)) params.set("status", csv(filters.status!));
  if (hasValue(filters.servicing)) params.set("servicing", csv(filters.servicing!));
  if (hasValue(filters.branchId)) params.set("branchId", csv(filters.branchId!));
  if (hasValue(filters.customerId)) params.set("customerId", csv(filters.customerId!));
  if (hasValue(filters.bankPledgeStatus)) params.set("bankPledgeStatus", csv(filters.bankPledgeStatus!));
  if (hasValue(filters.schemeId)) params.set("schemeId", csv(filters.schemeId!));
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const rec = await apiFetch<{ items: BackendLoan[]; hasMore: boolean; total?: number }>(`/loans?${params}`);
  return { items: (rec?.items || []).map(toView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
}

/* Page size for the paginated loan pickers. Ten rows per request — enough
 * that the dropdown fills its visible area on the first fetch, small enough
 * that scrolling keeps fetching rather than pulling the whole book. */
const LOAN_PAGE_SIZE = 10;

/* Paginated variant of listLoans — backs SearchableSelect's infinite scroll
 * (see SearchableSelect.tsx). `page` is 0-based; the backend responds with an
 * {items, hasMore} envelope whenever `limit` is passed (see
 * backend/internal/loan/handler.go's List). `q` matches the loan number.
 *
 * `excludeBankPledged` asks the server for only loans whose gold isn't
 * currently with a bank — the eligibility rule the bank re-pledge picker
 * used to apply client-side over a full loan list, which no longer works
 * once only one page is in the browser at a time. */
export async function searchLoansPage(
  q: string,
  page: number,
  opts?: { excludeBankPledged?: boolean; customerId?: number; status?: string[]; limit?: number }
): Promise<{ items: LoanView[]; hasMore: boolean }> {
  return orLocal(
    () => searchLoansPageLive(q, page, opts),
    () => {
      const pageSize = opts?.limit ?? LOAN_PAGE_SIZE;
      const all = sortNewestFirst(filterLocalLoans(localLoans(), { q, customerId: opts?.customerId, status: opts?.status })).filter((l) => !opts?.excludeBankPledged || canTakeBankPledge(l));
      const from = page * pageSize;
      return { items: all.slice(from, from + pageSize).map(toView), hasMore: from + pageSize < all.length };
    },
  );
}

async function searchLoansPageLive(
  q: string,
  page: number,
  opts?: { excludeBankPledged?: boolean; customerId?: number; status?: string[]; limit?: number }
): Promise<{ items: LoanView[]; hasMore: boolean }> {
  const pageSize = opts?.limit ?? LOAN_PAGE_SIZE;
  const params = new URLSearchParams({
    q,
    limit: String(pageSize),
    offset: String(page * pageSize),
  });
  if (opts?.excludeBankPledged) params.set("excludeBankPledged", "true");
  if (opts?.customerId) params.set("customerId", String(opts.customerId));
  if (opts?.status?.length) params.set("status", opts.status.join(","));
  const rec = await apiFetch<{ items: BackendLoan[]; hasMore: boolean }>(`/loans?${params}`);
  return { items: (rec?.items || []).map(toView), hasMore: !!rec?.hasMore };
}

/* True when a change made on this PC to the loan is still waiting in the outbox. While it is, the server's own copy
 * is older than what this PC shows, so a reload must not replace the screen with it (a release that was just saved would
 * look undone until the send finished). */
async function hasWaitingChange(uuid: string | undefined): Promise<boolean> {
  if (!uuid || !offlineReady()) return false;
  try {
    for (const line of await offlineStore.readAllOutbox()) {
      try {
        if ((JSON.parse(line) as { targets?: string[] }).targets?.includes(uuid)) return true;
      } catch {
        /* a line that cannot be read waits for nothing */
      }
    }
  } catch {
    /* the store is not readable: fall back to asking the server */
  }
  return false;
}

export async function getLoan(id: number): Promise<LoanView> {
  const waiting = offlineReady() ? localLoanByNumericId(id) : undefined;
  // a loan with changes waiting is shown from the local record, unless the local server can apply those changes itself (the
  // server's own code then works out the balances and interest, as it will once they are sent)
  if (waiting && (await hasWaitingChange(waiting.uuid)) && !(await loanChangesReplayable(waiting.uuid, id))) return toView(waiting);
  return orLocal(
    async () => toView(await apiFetch<BackendLoan>(`/loans/${id}`)),
    () => {
      const rec = localLoanByNumericId(id);
      if (!rec) throw new ApiError("Loan not found", 404);
      return toView(rec);
    },
  );
}

/* Direct, atomic lookup by loan number (backend/internal/loan's GET
 * /loans/by-number/:loanNumber) — used by LoanDetail.tsx instead of the
 * previous listLoans({q}) + client-side find + getLoan two-step, which
 * needed two round trips and could show a transient "Loan not found" if
 * the list call raced against another in-flight /loans request. */
export async function getLoanByNumber(loanNumber: string): Promise<LoanView> {
  const waiting = offlineReady() ? localLoanByKey(loanNumber) : undefined;
  if (waiting && (await hasWaitingChange(waiting.uuid)) && !(await loanChangesReplayable(waiting.uuid, Number(waiting.id ?? 0)))) return toView(waiting);
  const local = () => {
    const rec = localLoanByKey(loanNumber);
    if (!rec) throw new ApiError("Loan not found", 404);
    return toView(rec);
  };
  // A loan made offline is known here only by its PENDING key until the server numbers it.
  if (offlineReady() && loanNumber.startsWith("PENDING-")) {
    const rec = localLoanByKey(loanNumber);
    if (rec && !rec.loanNumber) return toView(rec);
    if (rec) loanNumber = rec.loanNumber;
  }
  return orLocal(async () => toView(await apiFetch<BackendLoan>(`/loans/by-number/${encodeURIComponent(loanNumber)}`)), local);
}

export async function addOrnament(loanId: number, input: OrnamentRequestInput): Promise<LoanView> {
  if (offlineReady() && loanId) {
    const uuid = localLoanByNumericId(loanId)?.uuid;
    if (uuid) {
      checkOrnamentLocally(input);
      await queueRawIfUnreachable(OFFLINE_FIRST, "POST", `/loans/uuid:${uuid}/ornaments`, input, loanId);
      return toView(localLoanByNumericId(loanId)!);
    }
  }
  if (!loanId && offlineReady()) throw new ApiError(NOT_SYNCED, 0);
  if (offlineReady()) checkOrnamentLocally(input);
  try {
    const rec = await apiFetch<BackendLoan>(`/loans/${loanId}/ornaments`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return toView(rec);
  } catch (e) {
    const uuid = localLoanByNumericId(loanId)?.uuid;
    if (uuid && (await queueRawIfUnreachable(e, "POST", `/loans/uuid:${uuid}/ornaments`, input, loanId))) return toView(localLoanByNumericId(loanId)!);
    throw e;
  }
}

export async function updateOrnament(ornamentId: number, input: OrnamentRequestInput): Promise<LoanView> {
  if (offlineReady() && ornamentId > 0) {
    checkOrnamentLocally(input);
    await queueRawIfUnreachable(OFFLINE_FIRST, "PUT", `/loans/ornaments/${ornamentId}`, input);
    return placeholderLoanView();
  }
  if (ornamentId < 0 && offlineReady()) throw new ApiError(NOT_SYNCED, 0);
  if (offlineReady()) checkOrnamentLocally(input);
  try {
    const rec = await apiFetch<BackendLoan>(`/loans/ornaments/${ornamentId}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
    return toView(rec);
  } catch (e) {
    if (await queueRawIfUnreachable(e, "PUT", `/loans/ornaments/${ornamentId}`, input)) return placeholderLoanView();
    throw e;
  }
}

/* Refused server-side if this is the loan's last remaining ornament, or if
 * the loan is already Closed/Auctioned — see backend Service.DeleteOrnament. */
export async function deleteOrnament(ornamentId: number): Promise<LoanView> {
  if (offlineReady() && ornamentId > 0) {
    await queueRawIfUnreachable(OFFLINE_FIRST, "DELETE", `/loans/ornaments/${ornamentId}`, undefined);
    return placeholderLoanView();
  }
  if (ornamentId < 0 && offlineReady()) throw new ApiError(NOT_SYNCED, 0);
  try {
    const rec = await apiFetch<BackendLoan>(`/loans/ornaments/${ornamentId}`, { method: "DELETE" });
    return toView(rec);
  } catch (e) {
    if (await queueRawIfUnreachable(e, "DELETE", `/loans/ornaments/${ornamentId}`, undefined)) return placeholderLoanView();
    throw e;
  }
}

/* The callers of the ornament changes ignore the loan they get back (the screen reloads the loan), so a queued
 * change returns an empty one rather than a made-up loan. */
function placeholderLoanView(): LoanView {
  return {} as LoanView;
}

export async function recordPurityTest(ornamentId: number, input: PurityTestInput): Promise<BackendOrnament> {
  if (offlineReady() && ornamentId > 0) {
    await queueRawIfUnreachable(OFFLINE_FIRST, "POST", `/loans/ornaments/${ornamentId}/purity-test`, input);
    return {} as BackendOrnament;
  }
  try {
    return await apiFetch<BackendOrnament>(`/loans/ornaments/${ornamentId}/purity-test`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  } catch (e) {
    if (ornamentId > 0 && (await queueRawIfUnreachable(e, "POST", `/loans/ornaments/${ornamentId}/purity-test`, input))) return {} as BackendOrnament;
    throw e;
  }
}

/* FALLBACK ONLY — which sanction stages actually apply is now per-business
 * configuration (GET /approval-workflow, flow "loan_sanction"; read it via
 * useApprovalWorkflow() + approvalWorkflowService's chainFor/isFinalStage).
 * These constants describe the full catalogue chain and are kept for type
 * names and the few call sites that just need the canonical keys.
 *
 * The 3-stage loan sanction chain: a loan is made by a Loan Operator,
 * verified by the Loan Operator, approved by the Branch Manager, then
 * finally sanctioned by Management. `role` must match the stage's required
 * role below — except "Administrator", which may act at whichever stage is
 * currently pending. Mirrors the backend's SanctionStage constants and
 * sanctionChain.
 *
 * The old chain had a fourth "Authorized Management" checkpoint between
 * Branch Manager and Final Sanction, which made Management sign off twice;
 * the backend migrates any loan still on it to FinalSanction (see
 * loan.MigrateRetiredSanctionStage). */
export const SANCTION_STAGES = ["LoanOperator", "BranchManager", "FinalSanction"] as const;
export const SANCTION_STAGE_LABELS: Record<SanctionStage, string> = {
  LoanOperator: "Verified by Loan Operator",
  BranchManager: "Approved by Branch Manager",
  FinalSanction: "Final Sanction (Management)",
};
export const SANCTION_STAGE_ROLES: Record<SanctionStage, string> = {
  LoanOperator: "Loan Operator",
  BranchManager: "Branch Manager",
  FinalSanction: "Management",
};

export async function listLoanApprovals(loanId: number): Promise<ApprovalStageRecord[]> {
  return (await apiFetch<ApprovalStageRecord[]>(`/loans/${loanId}/approvals`)) || [];
}

/* The local copy's uuid for a loan the caller named only by its number: a loan this PC holds is always addressed by its uuid, so
 * it can be changed whether or not the server has numbered it. */
function resolveLoanUuid(loanId: number, uuid?: string): string | undefined {
  return uuid ?? (offlineReady() && loanId > 0 ? localLoanByNumericId(loanId)?.uuid : undefined);
}

export async function approveLoan(loanId: number, input: ApprovalInput, uuidIn?: string): Promise<LoanView> {
  const uuid = resolveLoanUuid(loanId, uuidIn);
  const ref = loanId || !uuid ? String(loanId) : `uuid:${uuid}`;
  const local = uuid ? (getLocal("loans", uuid) as unknown as BackendLoan | undefined) : undefined;
  if (!offlineReady() || !local) {
    const rec = await apiFetch<BackendLoan>(`/loans/${ref}/approve`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return toView(rec);
  }
  // Desktop: one explicit action is one outbox entry, addressed by the loan UUID so it can point at a loan
  // the server has not numbered yet. The local copy moves to the next stage in the same step.
  const chain = enabledStages(await fetchApprovalWorkflow().catch(() => []), "loan_sanction");
  // The last stage pays the loan out: refused here, as the server would, when the till or the chosen bank cannot cover it.
  // A UPI / Bank Transfer payout needs its bank offline too (the server refuses it without one), or nothing would be debited or checked.
  if (input.action !== "Rejected" && chain.length > 0 && chain[chain.length - 1].key === input.stage && ((input.upiAmount ?? 0) > 0 || (input.bankTransferAmount ?? 0) > 0) && !input.bankId) {
    throw new ApiError("select the bank for the UPI / Bank Transfer part", 400);
  }
  if (input.action === "Approved" && chain.length > 0 && chain[chain.length - 1].key === input.stage) await assertPayoutFunds(local.branchId, partsOfSplit(input));
  checkApprovalLocally(local, input, chain);
  const actor = currentActor();
  const entry = newEntry("POST", `/loans/uuid:${uuid}/approve`, input, actor, [uuid!]);
  const before = local;
  const after = applyActionLocally(local, input, chain, actor);
  await enqueueAndWait(
    entry,
    () => upsertLocal("loans", after as unknown as LocalRecord),
    () => upsertLocal("loans", before as unknown as LocalRecord),
  );
  return toView((getLocal("loans", uuid!) as unknown as BackendLoan | undefined) ?? after);
}

/* What editing a loan that is already paid out would change — before and after, and the later payments that no longer
 * fit — without saving anything. Desktop with no answer from the server: there is nothing to preview, and the edit is
 * queued as it stands (the server applies it when it is sent). */
export async function previewLoanEdit(loanId: number, input: UpdateLoanInput): Promise<LedgerPaymentEditPreview> {
  try {
    return await apiFetch<LedgerPaymentEditPreview>(`/loans/${loanId}?dry_run=true`, { method: "PATCH", body: JSON.stringify(input) });
  } catch (e) {
    if (offlineReady() && e instanceof ApiError && e.status === 0) return {} as LedgerPaymentEditPreview;
    throw e;
  }
}

/* The newest edit of this loan still waiting in the outbox, if any. */
async function waitingLoanEdit(uuid: string): Promise<OutboxEntry | null> {
  let found: OutboxEntry | null = null;
  for (const line of await offlineStore.readAllOutbox().catch(() => [] as string[])) {
    try {
      const e = JSON.parse(line) as OutboxEntry;
      if (e.method === "PATCH" && e.path === `/loans/uuid:${uuid}`) found = e;
    } catch {
      /* a line that cannot be read is not this one */
    }
  }
  return found;
}

export async function updateLoan(loanId: number, input: UpdateLoanInput, uuidIn?: string): Promise<LoanView> {
  const uuid = resolveLoanUuid(loanId, uuidIn);
  const local = uuid ? (getLocal("loans", uuid) as unknown as BackendLoan | undefined) : undefined;
  // Desktop: the change goes into the outbox first and shows on this loan at once; the sender posts it.
  if (offlineReady() && local && uuid) {
    const entry = newEntry("PATCH", `/loans/uuid:${uuid}`, input, currentActor(), [uuid]);
    const chain = enabledStages(await fetchApprovalWorkflow().catch(() => []), "loan_sanction");
    const firstStage = chain[0]?.pending ?? local.approvalStage ?? "LoanOperator";
    // a new scheme brings its own LTV, rates and service charge; the loan's figures follow them, as they do on the server
    let terms: EditSchemeTerms | undefined;
    if (typeof input.schemeId === "number" && input.schemeId !== local.schemeId) {
      const s = (await listSchemes().catch(() => [] as SchemeView[])).find((x) => x.id === String(input.schemeId));
      if (s) terms = { name: s.name, rate: s.rate, ltv: s.ltv, method: s.method, penal: s.penal, serviceChargeType: s.serviceChargeType, serviceChargeValue: s.serviceChargeValue, serviceChargeMode: s.serviceChargeMode };
    }
    const edited = applyEditLocally(local, input, firstStage, currentActor(), terms);
    const after = input.additionalInfo !== undefined ? { ...edited, additionalInfo: input.additionalInfo } : edited;
    // An edit of a loan whose earlier edit has not been sent yet joins that entry (the newer values win), so saving a loan
    // three times sends ONE edit, not three that the server has to take one after another.
    const earlier = await waitingLoanEdit(uuid);
    if (earlier) {
      try {
        await changeWithEntry(earlier.id, JSON.stringify({ ...earlier, body: { ...((earlier.body ?? {}) as object), ...input } }), () => upsertLocal("loans", after as unknown as LocalRecord));
        return toView(after);
      } catch {
        /* it was sent (or refused) in the meantime: this edit is an entry of its own */
      }
    }
    await enqueueAndWait(
      entry,
      () => upsertLocal("loans", after as unknown as LocalRecord),
      () => upsertLocal("loans", local as unknown as LocalRecord),
    );
    return toView(after);
  }
  const rec = await apiFetch<BackendLoan>(`/loans/${loanId || `uuid:${uuid}`}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return toView(rec);
}

/* Permanently deletes a loan and every record tied to it — a real DELETE,
 * no undo. Gated server-side by its own "can hard delete loan" permission,
 * independent of the ordinary "can delete loan" grant — see backend
 * Service.HardDeleteLoan's own doc comment for the full cascade. */
export async function hardDeleteLoan(loanId: number, uuidIn?: string): Promise<void> {
  const uuid = resolveLoanUuid(loanId, uuidIn);
  // A loan this PC holds that the server has numbered: the delete goes into the outbox first and the loan leaves the list now.
  if (offlineReady() && loanId > 0 && uuid) {
    const held = getLocal("loans", uuid) as unknown as BackendLoan | undefined;
    if (held) {
      const entry = newEntry("DELETE", `/loans/uuid:${uuid}/hard-delete`, undefined, currentActor(), [uuid]);
      await enqueueAndWait(entry, () => removeLocal("loans", uuid), () => upsertLocal("loans", held as unknown as LocalRecord));
      return;
    }
  }
  // A loan this PC made that the server has never seen: deleting it just cancels what was waiting to be sent.
  if (offlineReady() && !loanId && uuid) {
    for (const line of await offlineStore.readAllOutbox()) {
      try {
        const e = JSON.parse(line) as { id: string; targets?: string[] };
        if (e.targets?.includes(uuid)) await offlineStore.deleteOutboxEntry(e.id);
      } catch {
        /* a line that cannot be read touches nothing */
      }
    }
    await removeLocal("loans", uuid);
    return;
  }
  try {
    await apiFetch<unknown>(`/loans/${loanId}/hard-delete`, { method: "DELETE" });
  } catch (e) {
    // Desktop with no answer from the server: the loan leaves this PC's list now and the delete is sent later.
    const local = uuid ? (getLocal("loans", uuid) as unknown as BackendLoan | undefined) : undefined;
    if (!offlineReady() || !(e instanceof ApiError) || e.status !== 0 || !local || !uuid) throw e;
    const entry = newEntry("DELETE", `/loans/uuid:${uuid}/hard-delete`, undefined, currentActor(), [uuid]);
    await enqueueAndWait(entry, () => removeLocal("loans", uuid), () => upsertLocal("loans", local as unknown as LocalRecord));
  }
}

export async function recordPayment(loanId: number, input: PaymentInput, uuidIn?: string): Promise<LoanView> {
  const uuid = resolveLoanUuid(loanId, uuidIn);
  const local = uuid ? (getLocal("loans", uuid) as unknown as BackendLoan | undefined) : undefined;
  if (!offlineReady() || !local) {
    const rec = await apiFetch<BackendLoan>(`/loans/${loanId}/payments`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return toView(rec);
  }
  // Desktop: the payment is one outbox entry addressed by the loan UUID. It shows on the loan at once; the
  // server works out the split and the new balances when it receives the entry.
  checkPaymentLocally(local, input);
  const actor = currentActor();
  const entry = newEntry("POST", `/loans/uuid:${uuid}/payments`, input, actor, [uuid!]);
  const before = local;
  const after = applyPaymentLocally(local, input, actor);
  // the payment is listed under an id made from its entry, so it can be edited or taken back before it is sent
  const row = (after.payments ?? [])[(after.payments ?? []).length - 1];
  if (row) row.id = localRequestId(entry.id);
  await enqueueAndWait(
    entry,
    () => upsertLocal("loans", after as unknown as LocalRecord),
    () => upsertLocal("loans", before as unknown as LocalRecord),
  );
  return toView((getLocal("loans", uuid!) as unknown as BackendLoan | undefined) ?? after);
}

/* A payment made on this PC and not sent yet: its entry (found by the local id it is listed under) and the loan it is on. */
async function waitingLoanPayment(loanId: number, paymentId: number): Promise<{ entry: OutboxEntry; loan: BackendLoan & { uuid: string }; payment: BackendLoanPayment }> {
  const loan = localLoanByNumericId(loanId);
  const payment = loan?.payments?.find((p) => p.id === paymentId);
  let entry: OutboxEntry | undefined;
  for (const line of await offlineStore.readAllOutbox().catch(() => [] as string[])) {
    try {
      const e = JSON.parse(line) as OutboxEntry;
      if (e.method === "POST" && /^\/loans\/uuid:[0-9a-f-]+\/payments$/i.test(e.path) && localRequestId(e.id) === paymentId) entry = e;
    } catch {
      /* a line that cannot be read is not this one */
    }
  }
  if (!loan || !payment || !entry) throw new ApiError("This payment was sent while you were editing. Refresh, then edit it.", 409);
  return { entry, loan, payment };
}

/* Edit of a payment that has not been sent: the waiting entry is rewritten and the local loan recalculated with it, so
 * what is sent later is the corrected payment. */
async function editWaitingLoanPayment(loanId: number, paymentId: number, input: EditLedgerPaymentInput): Promise<LedgerPaymentEditPreview> {
  const { entry, loan, payment } = await waitingLoanPayment(loanId, paymentId);
  const old = (entry.body ?? {}) as PaymentInput;
  const next: PaymentInput = {
    ...old,
    amount: input.amount ?? old.amount,
    paidOn: input.paidOn ?? old.paidOn,
    type: input.type ?? old.type,
    processingFee: input.processingFee ?? old.processingFee,
    cashAmount: input.cashAmount ?? old.cashAmount,
    upiAmount: input.upiAmount ?? old.upiAmount,
    bankTransferAmount: input.bankTransferAmount ?? old.bankTransferAmount,
    chequeAmount: input.chequeAmount ?? old.chequeAmount,
    bankId: input.bankId ?? old.bankId,
    reference: input.reference ?? old.reference,
    description: input.description ?? old.description,
  };
  const actor = currentActor();
  const after = applyPaymentLocally(reversePaymentLocally(loan, payment), next, actor);
  const row = (after.payments ?? [])[(after.payments ?? []).length - 1];
  if (row) row.id = paymentId;
  await changeWithEntry(entry.id, JSON.stringify({ ...entry, body: next }), () => upsertLocal("loans", { ...after, uuid: loan.uuid } as unknown as LocalRecord));
  return { dryRun: false } as unknown as LedgerPaymentEditPreview;
}

/* Delete of a payment that has not been sent: the waiting entry is dropped, so the server never hears of it, and the local
 * loan gets back what it paid. */
async function deleteWaitingLoanPayment(loanId: number, paymentId: number): Promise<LedgerPaymentEditPreview> {
  const { entry, loan, payment } = await waitingLoanPayment(loanId, paymentId);
  const after = reversePaymentLocally(loan, payment);
  await changeWithEntry(entry.id, "", () => upsertLocal("loans", { ...after, uuid: loan.uuid } as unknown as LocalRecord));
  return { dryRun: false } as unknown as LedgerPaymentEditPreview;
}

/* When the business has the loan_topup approval flow switched on, this
 * returns the loan UNCHANGED and parks a "Pending" top-up row in the chain
 * instead (see listTopUps/approveTopUp below) — nothing is paid out until its
 * final stage approves it. Only one pending top-up per loan (409 otherwise). */
export async function topUpLoan(loanId: number, input: TopUpInput): Promise<LoanView> {
  const local = offlineReady() ? localLoanByNumericId(loanId) : undefined;
  if (local?.uuid) {
    const round = (n: number) => Math.round(n * 100) / 100;
    // the refusals the server gives, raised here before anything is queued
    if (!(input.amount > 0)) throw new ApiError("amount must be greater than zero", 400);
    if (!["Active", "Due Soon", "Overdue"].includes(local.status)) throw new ApiError("loan must be Active to top up", 409);
    if (round(input.amount) > round((local.eligibleLoanAmount ?? 0) - (local.outstandingAmount ?? 0)) + 0.01) {
      throw new ApiError("amount is above the loan limit", 400);
    }
    const penalOwed = Math.max(0, (local.accruedPenalInterest ?? 0) > 0 ? (local.accruedPenalInterest ?? 0) - (local.penalInterestPaid ?? 0) : (local.outstandingPenalInterest ?? 0));
    const interestOwed = Math.max(0, (local.accruedInterest ?? 0) > 0 ? (local.accruedInterest ?? 0) - (local.interestPaid ?? 0) : (local.outstandingInterest ?? 0));
    const arrears = round(penalOwed + interestOwed);
    const deduct = input.settleInterest === "deduct";
    if (arrears > 0.01 && !deduct) throw new ApiError("pay the outstanding interest first", 400);
    const needsApproval = enabledStages(await fetchApprovalWorkflow().catch(() => []), "loan_topup").length > 0;
    checkTopUpLocally(local, input, needsApproval);
    // with no approval step the top-up is paid out at once: the till or the chosen bank has to cover it (less what it deducts)
    if (!needsApproval) await assertPayoutFunds(local.branchId, partsOfSplit({ ...input, cashAmount: input.cashAmount === undefined && !input.upiAmount && !input.bankTransferAmount ? Math.max(0, input.amount - (deduct ? Math.min(arrears, input.amount) : 0)) : input.cashAmount }));
    const taken = deduct ? Math.min(arrears, input.amount) : 0;
    const penalTaken = Math.min(taken, penalOwed);
    const interestTaken = taken - penalTaken;
    // with the approval flow on, the loan is unchanged until a top-up is approved; otherwise it is paid out at once
    const queued = await queueFirst(loanId, "/topup", "POST", input, (loan) =>
      needsApproval
        ? loan
        : {
            ...loan,
            principalAmount: round(loan.principalAmount + input.amount),
            outstandingAmount: round(loan.outstandingAmount + input.amount),
            totalOutstandingBalance: round((loan.totalOutstandingBalance ?? 0) + input.amount - taken),
            settlementAmount: round((loan.settlementAmount ?? 0) + input.amount - taken),
            interestPaid: round((loan.interestPaid ?? 0) + interestTaken),
            penalInterestPaid: round((loan.penalInterestPaid ?? 0) + penalTaken),
            outstandingInterest: round(Math.max(0, interestOwed - interestTaken)),
            outstandingPenalInterest: round(Math.max(0, penalOwed - penalTaken)),
            localTopUps: [
              ...(loan.localTopUps ?? []),
              {
                id: 0,
                amount: input.amount,
                eligibleAmountAtTopUp: round(loan.eligibleLoanAmount ?? 0),
                cashAmount: input.cashAmount ?? 0,
                upiAmount: input.upiAmount ?? 0,
                bankTransferAmount: input.bankTransferAmount ?? 0,
                chequeAmount: input.chequeAmount ?? 0,
                occurredOn: input.occurredOn ?? new Date().toISOString().slice(0, 10),
                reference: input.reference ?? "",
                status: "Active" as const,
                approvalStage: "",
                settleInterest: input.settleInterest ?? "require",
                createdAt: new Date().toISOString(),
              },
            ],
            updatedAt: new Date().toISOString(),
          },
    );
    if (queued) return toView(queued);
  }
  const rec = await apiFetch<BackendLoan>(`/loans/${loanId}/topup`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toView(rec);
}

export async function listTopUps(loanId: number): Promise<LoanTopUpView[]> {
  return (await apiFetch<LoanTopUpView[]>(`/loans/${loanId}/topups`)) || [];
}

export async function approveTopUp(topUpId: number, input: TopUpApprovalInput): Promise<LoanTopUpView> {
  if (canQueue()) return queueOnly("POST", `/loans/topups/${topUpId}/approve`, input, { id: topUpId } as unknown as LoanTopUpView);
  return apiFetch<LoanTopUpView>(`/loans/topups/${topUpId}/approve`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function recordBankPledge(loanId: number, input: BankPledgeInput): Promise<LoanView> {
  if (offlineReady() && loanId) {
    const rec = localLoanByNumericId(loanId);
    if (rec) checkBankPledgeLocally(rec, input);
  }
  // the loan shows as pledged at once, with the new pledge listed (id 0 until the server numbers it)
  const queued = await queueFirst(loanId, "/bank-pledge", "POST", input, (loan, entryId) => ({
    ...loan,
    bankPledgeStatus: "Bank Pledged",
    bankPledges: [
      ...(loan.bankPledges ?? []),
      {
        // no server id yet: a negative one that is only ever used on this PC, plus the entry that will create it
        id: localPledgeId(entryId),
        clientRef: entryId,
        loanId,
        bankName: input.bankName,
        pledgedAmount: input.pledgedAmount,
        pledgeDate: input.pledgeDate,
        releaseDate: null,
        bankPledgeDueDate: input.bankPledgeDueDate ?? null,
        bankInterestRate: input.bankInterestRate ?? 0,
        referenceNumber: input.referenceNumber ?? "",
        cashTreatment: input.cashTreatment ?? "RecordOnly",
        status: "Active",
        voidedAt: null,
        voidReason: "",
        events: [],
      } as unknown as BackendBankPledgeRecord,
    ],
    updatedAt: new Date().toISOString(),
  }));
  if (queued) return toView(queued);
  const rec = await apiFetch<BackendLoan>(`/loans/${loanId}/bank-pledge`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toView(rec);
}

/* `payment` is how the pledged amount is paid back to the bank (only used for
 * a "CashIn" pledge; omitted = all Cash) and the branch bank account a UPI/
 * Bank Transfer/Cheque share leaves from. */
export async function releaseBankPledge(
  loanId: number,
  pledgeId: number,
  payment?: { cashAmount: number; upiAmount: number; bankTransferAmount: number; chequeAmount: number; bankId?: number }
): Promise<LoanView> {
  // Desktop: the release goes into the outbox first, the pledge shows as released at once, and the sender posts it.
  // It needs the pledge to be on the server already (its id is the server's), so a pledge recorded offline waits.
  const local = offlineReady() ? localLoanByNumericId(loanId) : undefined;
  const pledge = pledgeId !== 0 ? local?.bankPledges?.find((p) => p.id === pledgeId && (p.status || "Active") === "Active") : undefined;
  if (local?.uuid && pledge) {
    // a pledge recorded on this PC is addressed by the entry that creates it until the server has numbered it
    const ref = pledgeId < 0 ? `ref:${(pledge as { clientRef?: string }).clientRef}` : String(pledgeId);
    const entry = newEntry("PUT", `/loans/uuid:${local.uuid}/bank-pledge/${ref}/release`, payment, currentActor(), [local.uuid]);
    const now = new Date().toISOString();
    const after = {
      ...local,
      bankPledgeStatus: "Released",
      bankPledges: (local.bankPledges ?? []).map((p) => (p.id === pledgeId ? { ...p, status: "Released", releaseDate: now } : p)),
      updatedAt: now,
    } as BackendLoan & { uuid: string };
    await enqueueAndWait(
      entry,
      () => upsertLocal("loans", after as unknown as LocalRecord),
      () => upsertLocal("loans", local as unknown as LocalRecord),
    );
    return toView(after);
  }
  const rec = await apiFetch<BackendLoan>(`/loans/${loanId}/bank-pledge/${pledgeId}/release`, {
    method: "PUT",
    ...(payment ? { body: JSON.stringify(payment) } : {}),
  });
  return toView(rec);
}

/* voidBankPledge cancels a re-pledge recorded in error — the only way to fix a
 * mis-chosen cashTreatment. Restricted server-side to Branch Manager/
 * Management/Administrator. Books a compensating cash-out only if the original
 * actually moved cash; the voided record stays visible in history. */
export async function voidBankPledge(loanId: number, pledgeId: number, reason: string): Promise<LoanView> {
  const local = offlineReady() ? localLoanByNumericId(loanId) : undefined;
  const pledge = local?.bankPledges?.find((p) => p.id === pledgeId && (p.status || "Active") === "Active");
  if (local?.uuid && pledge) {
    if (!reason.trim()) throw new ApiError("a reason is required when voiding a bank pledge", 400);
    const clientRef = (pledge as { clientRef?: string }).clientRef;
    const now = new Date().toISOString();
    const settle = (pledges: BackendBankPledgeRecord[]) =>
      pledges.some((p) => (p.status || "Active") === "Active") ? "Bank Pledged" : "Not Pledged";
    // Still waiting in the outbox: nothing has reached the server, so voiding it just cancels what was waiting to be sent
    // (the pledge, and anything queued against it).
    let cancelled = false;
    if (pledgeId < 0 && clientRef) {
      for (const line of await offlineStore.readAllOutbox()) {
        try {
          const e = JSON.parse(line) as { id: string; path?: string };
          if (e.id === clientRef || (e.path ?? "").includes(`/bank-pledge/ref:${clientRef}/`)) {
            await offlineStore.deleteOutboxEntry(e.id);
            if (e.id === clientRef) cancelled = true;
          }
        } catch {
          /* a line that cannot be read touches nothing */
        }
      }
    }
    if (cancelled) {
      const kept = (local.bankPledges ?? []).filter((p) => p.id !== pledgeId);
      const after = { ...local, bankPledges: kept, bankPledgeStatus: settle(kept), updatedAt: now } as BackendLoan & { uuid: string };
      await upsertLocal("loans", after as unknown as LocalRecord);
      return toView(after);
    }
    const ref = pledgeId < 0 && clientRef ? `ref:${clientRef}` : String(pledgeId);
    const entry = newEntry("PUT", `/loans/uuid:${local.uuid}/bank-pledge/${ref}/void`, { reason }, currentActor(), [local.uuid]);
    const marked: BackendBankPledgeRecord[] = (local.bankPledges ?? []).map((p) =>
      p.id === pledgeId ? { ...p, status: "Voided" as const, voidedAt: now, voidReason: reason } : p,
    );
    const after = { ...local, bankPledges: marked, bankPledgeStatus: settle(marked), updatedAt: now } as BackendLoan & { uuid: string };
    await enqueueAndWait(
      entry,
      () => upsertLocal("loans", after as unknown as LocalRecord),
      () => upsertLocal("loans", local as unknown as LocalRecord),
    );
    return toView(after);
  }
  const rec = await apiFetch<BackendLoan>(`/loans/${loanId}/bank-pledge/${pledgeId}/void`, {
    method: "PUT",
    body: JSON.stringify({ reason }),
  });
  return toView(rec);
}

function toBankPledgeRecordView(r: BackendBankPledgeRecord & { loanNumber?: string; customerName?: string }): BankPledgeRecordView {
  return {
    id: r.id,
    loanId: r.loanId,
    loanNumber: r.loanNumber,
    customerName: r.customerName,
    bankName: r.bankName,
    pledgedAmount: r.pledgedAmount,
    pledgeDate: r.pledgeDate ? r.pledgeDate.slice(0, 10) : "",
    releaseDate: r.releaseDate ? r.releaseDate.slice(0, 10) : null,
    bankPledgeDueDate: r.bankPledgeDueDate ? r.bankPledgeDueDate.slice(0, 10) : null,
    bankInterestRate: r.bankInterestRate,
    referenceNumber: r.referenceNumber,
    // Rows predating the field default to CashIn server-side, which is what
    // they genuinely did — mirror that here rather than showing them as blank.
    cashTreatment: r.cashTreatment || "CashIn",
    status: r.status || "Active",
    voidedAt: r.voidedAt ? r.voidedAt.slice(0, 10) : null,
    voidReason: r.voidReason || "",
    bankId: r.bankId ?? null,
    cashAmount: r.cashAmount ?? 0,
    upiAmount: r.upiAmount ?? 0,
    bankTransferAmount: r.bankTransferAmount ?? 0,
    receivedBankId: r.receivedBankId ?? null,
    releaseCashAmount: r.releaseCashAmount ?? 0,
    releaseUpiAmount: r.releaseUpiAmount ?? 0,
    releaseBankTransferAmount: r.releaseBankTransferAmount ?? 0,
    releaseBankId: r.releaseBankId ?? null,
    ornamentNames: r.ornamentNames || [],
    events: (r.events || []).map((e) => ({
      id: e.id,
      action: e.action,
      actorRole: e.actorRole || "",
      amount: e.amount,
      remarks: e.remarks || "",
      createdAt: e.createdAt ? e.createdAt.slice(0, 10) : "",
    })),
  };
}

/* Releases made on this PC that the server has not been sent yet: the history shows those pledges as released, the
 * same as the loan's own page does, so the same pledge cannot be released twice. */
async function withPendingReleases(rows: BankPledgeRecordView[]): Promise<BankPledgeRecordView[]> {
  if (!offlineReady() || !rows.some((r) => r.status === "Active")) return rows;
  const released = new Map<number, string>();
  const voided = new Set<number>();
  for (const line of await offlineStore.readAllOutbox().catch(() => [] as string[])) {
    try {
      const e = JSON.parse(line) as { method?: string; path?: string; occurredAt?: string };
      const m = /\/bank-pledge\/(\d+)\/release$/.exec(e.path ?? "");
      if (e.method === "PUT" && m) released.set(Number(m[1]), (e.occurredAt ?? new Date().toISOString()).slice(0, 10));
      const v = /\/bank-pledge\/(\d+)\/void$/.exec(e.path ?? "");
      if (e.method === "PUT" && v) voided.add(Number(v[1]));
    } catch {
      /* a line that cannot be read releases nothing */
    }
  }
  if (!released.size && !voided.size) return rows;
  return rows.map((r) =>
    r.status !== "Active"
      ? r
      : voided.has(r.id)
        ? { ...r, status: "Voided" }
        : released.has(r.id)
          ? { ...r, status: "Released", releaseDate: released.get(r.id) ?? null }
          : r,
  );
}

/* Re-pledges recorded on this PC that the server has not numbered yet: the history lists them (Active, with a local
 * negative id) so they can be released or voided before they are sent. */
function unsentPledges(loanId?: number, query?: string): BankPledgeRecordView[] {
  if (!offlineReady()) return [];
  const q = (query ?? "").trim().toLowerCase();
  const out: BankPledgeRecordView[] = [];
  for (const l of localLoans()) {
    if (loanId !== undefined && l.id !== loanId) continue;
    for (const p of l.bankPledges ?? []) {
      if (p.id >= 0) continue;
      const row = toBankPledgeRecordView({ ...p, loanId: l.id, loanNumber: l.loanNumber || (l.uuid ? pendingKey(l.uuid) : ""), customerName: l.customer?.name } as BackendBankPledgeRecord & { loanNumber?: string; customerName?: string });
      if (q && !JSON.stringify(row).toLowerCase().includes(q)) continue;
      out.push(row);
    }
  }
  return out;
}

export async function getBankPledgeHistory(loanId: number): Promise<BankPledgeRecordView[]> {
  const recs = await apiFetch<BackendBankPledgeRecord[] | null>(`/loans/${loanId}/bank-pledge/history`);
  return withPendingReleases([...unsentPledges(loanId), ...(recs || []).map(toBankPledgeRecordView)]);
}

export async function listBankPledgeHistory(): Promise<BankPledgeRecordView[]> {
  const recs = await apiFetch<BackendBankPledgeRecord[] | null>(`/loans/bank-pledges/history`);
  return withPendingReleases([...unsentPledges(), ...(recs || []).map(toBankPledgeRecordView)]);
}

export const BANK_PLEDGE_HISTORY_PAGE_SIZE = 10;

// listBankPledgeHistoryPage backs the Bank Re-Pledge screen's History tab
// pagination — see Loans.tsx's listLoansPage for the same {items, hasMore}
// envelope pattern.
export async function listBankPledgeHistoryPage(
  page: number,
  limit?: number,
  query?: string,
  range?: { from?: string; to?: string }
): Promise<{ items: BankPledgeRecordView[]; hasMore: boolean; total: number }> {
  const pageSize = limit ?? (isSmallScreen() ? 7 : 10);
  const offset = (page - 1) * pageSize;
  const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
  if (query) params.set("q", query);
  if (range?.from) params.set("from", range.from);
  if (range?.to) params.set("to", range.to);
  const res = await apiFetch<{ items: (BackendBankPledgeRecord & { loanNumber?: string; customerName?: string })[] | null; hasMore: boolean; total?: number }>(
    `/loans/bank-pledges/history?${params.toString()}`
  );
  const unsent = page === 1 ? unsentPledges(undefined, query) : [];
  return { items: await withPendingReleases([...unsent, ...(res.items || []).map(toBankPledgeRecordView)]), hasMore: res.hasMore, total: (res.total ?? 0) + unsent.length };
}

export const CASH_TREATMENT_LABELS: Record<BankPledgeCashTreatment, string> = {
  CashIn: "Cash Added",
  RecordOnly: "Record Only",
};

/* Auction workflow — full 7-stage rebuild (see
 * backend/internal/loan/model.go's AuctionRecord/AuctionNotice). Overdue/
 * Defaulted are LoanView's isOverdue/isDefaulted flags (section 2); the
 * stages below only exist once a defaulted loan is actually marked
 * auction-eligible. */
/* AUCTION_STAGES drives the visual stepper, so it lists only the forward path.
 * "Withdrawn" is a second terminal stage — reached when management pulls a case
 * out after the customer paid — and is deliberately excluded here because it is
 * an exit, not a step along the way. */
/* The Auctions page's Active Cases rule — the dashboard's "Auction Cases" tile
 * counts with it too, so the tile and the page agree. "Auctioned - Balance Due"
 * stays in so a short-sale case keeps showing while its shortfall is open. */
export function isActiveAuctionCase(l: LoanView): boolean {
  // A loan cleared by payment is never a live case, whatever its saved status or an old auction record says.
  const sold = l.status === "Auctioned" || l.status === "Auctioned - Balance Due";
  if (!sold && (l.status === "Closure Requested" || l.status === "Closed" || l.totalOutstandingBalance <= 0.01)) return false;
  return l.isDefaulted || l.status === "Auction Eligible" || sold;
}

/* The ONE status a loan reads as — used by every row and header so a loan never shows two. Saved statuses that are not
 * servicing states (Pending Approval, Closure Requested, Auction…, Closed, Rejected) stand as they are; a loan with
 * nothing left to pay is Closure Requested; otherwise Defaulted, Overdue (past term with interest/penal owed),
 * Due Soon, or Active. Mirrors the backend's effectiveStatus, which the status tabs filter by. */
export function loanDisplayStatus(l: LoanView): string {
  switch (l.status) {
    case "Active": case "Due Soon": case "Overdue": case "Auction Eligible": break;
    default: return l.status;
  }
  if (l.totalOutstandingBalance <= 0.01) return "Closure Requested";
  if (l.status === "Auction Eligible") return l.status;
  if (l.isDefaulted) return "Defaulted";
  if (l.isOverdue) return l.outstandingInterest > 0.01 || l.outstandingPenalInterest > 0.01 ? "Overdue" : "Active";
  if (l.isDueSoon) return "Due Soon";
  return "Active";
}

export const AUCTION_STAGES = ["AuctionEligible", "NoticeIssued", "AuctionScheduled", "Auctioned", "Settled"] as const;
export const AUCTION_STAGE_LABELS: Record<AuctionStage, string> = {
  AuctionEligible: "Auction Eligible",
  NoticeIssued: "Notice Issued",
  AuctionScheduled: "Auction Scheduled",
  Auctioned: "Auctioned",
  Settled: "Settled",
  Withdrawn: "Withdrawn",
};

/* A case is concluded once it reaches either terminal stage. Only concluded
 * cases free a loan to start a fresh auction if it defaults again. */
export function isAuctionConcluded(stage: AuctionStage): boolean {
  return stage === "Settled" || stage === "Withdrawn";
}

/* Plain-English outcome labels for the History tab — the raw enum values say
 * little about what actually happened to the customer's gold. */
export const AUCTION_OUTCOME_LABELS: Record<AuctionSettlementStatus, string> = {
  Pending: "Awaiting settlement",
  SettledByRepayment: "Settled by repayment",
  WrittenOff: "Closed — written off",
  SettledToCustomer: "Settled — surplus refunded",
  SettledToLoanCo: "Settled — surplus retained",
};

export const AUCTION_EVENT_LABELS: Record<string, string> = {
  Eligible: "Marked auction-eligible",
  NoticeIssued: "Notice issued",
  Scheduled: "Auction scheduled",
  SaleRecorded: "Sale recorded",
  Settled: "Settled",
  SettledByRepaymentAuto: "Auto-settled by repayment",
  DecisionRequested: "Decision requested (part-payment)",
  ShortfallEscalated: "Shortfall escalated",
  DecisionKeep: "Decision: keep in auction",
  DecisionRemove: "Decision: removed from auction",
  DecisionWriteOff: "Decision: balance written off",
  DecisionPursue: "Decision: pursue balance",
};

/* Convenience accessors used by the Auctions UI to decide what to render. */
export function pendingDecision(rec: AuctionRecordView | null | undefined): AuctionDecisionRequestView | null {
  return rec?.decisionRequests.find((d) => d.status === "Pending") ?? null;
}
export function hasUndisposedSurplus(rec: AuctionRecordView): boolean {
  return rec.surplusPayableAmount > 0.01 && !rec.surplusDisposition;
}

export function toAuctionRecordView(r: BackendAuctionRecord): AuctionRecordView {
  return {
    id: r.id,
    loanId: r.loanId,
    stage: r.stage,
    auctionEligibleDate: r.auctionEligibleDate ? r.auctionEligibleDate.slice(0, 10) : "",
    auctionDate: r.auctionDate ? r.auctionDate.slice(0, 10) : null,
    auctionReferenceNumber: r.auctionReferenceNumber,
    saleAmount: r.saleAmount,
    auctionExpenses: r.auctionExpenses,
    surplusShortfall: roundRupee(r.surplusShortfall),
    surplusPayableAmount: roundRupee(r.surplusPayableAmount ?? 0),
    surplusDisposition: r.surplusDisposition || "",
    surplusRemarks: r.surplusRemarks || "",
    finalSettlementStatus: r.finalSettlementStatus,
    notices: (r.notices || []).map((n) => ({ id: n.id, issuedAt: n.issuedAt.slice(0, 10), method: n.method, remarks: n.remarks })),
    events: (r.events || []).map((e) => ({
      id: e.id,
      action: e.action,
      actorRole: e.actorRole || "",
      remarks: e.remarks || "",
      createdAt: e.createdAt ? e.createdAt.slice(0, 10) : "",
    })),
    decisionRequests: (r.decisionRequests || []).map((d) => ({
      id: d.id,
      auctionRecordId: d.auctionRecordId,
      loanId: d.loanId,
      kind: d.kind,
      amountPaid: roundRupee(d.amountPaid),
      outstandingAtRequest: roundRupee(d.outstandingAtRequest),
      status: d.status,
      decidedByRole: d.decidedByRole || "",
      decisionRemarks: d.decisionRemarks || "",
      createdAt: d.createdAt ? d.createdAt.slice(0, 10) : "",
      decidedAt: d.decidedAt ? d.decidedAt.slice(0, 10) : null,
    })),
  };
}
export function toCustomerAuctionRowView(r: BackendCustomerAuctionRow): CustomerAuctionRowView {
  return { ...toAuctionRecordView(r), loanNumber: r.loanNumber };
}
export function toConcludedAuctionRowView(r: BackendConcludedAuctionRow): ConcludedAuctionRowView {
  return { ...toAuctionRecordView(r), loanNumber: r.loanNumber, customerName: r.customerName };
}

export async function getAuctionRecord(loanId: number): Promise<AuctionRecordView | null> {
  try {
    const rec = await apiFetch<BackendAuctionRecord | null>(`/loans/${loanId}/auction?optional=1`);
    return rec ? toAuctionRecordView(rec) : null;
  } catch {
    return null; // no auction case started yet for this loan
  }
}

/* Offline: an auction step goes into the outbox, addressed by the loan's server id, and the case on screen moves to the
 * stage it will be in at once (the last answer for the case, with the new stage on it). The server's own case replaces it
 * after the send. Returns null when this is not the desktop with offline mode running, so the caller makes the request as usual. */
async function auctionQueued(loanId: number, step: string, body: unknown, stage: AuctionStage, patch: Partial<AuctionRecordView> = {}): Promise<AuctionRecordView | null> {
  if (!canQueue() || !(loanId > 0)) return null;
  const current = await getAuctionRecord(loanId);
  checkAuctionStepLocally(step, body, current?.stage);
  // the stage is kept per loan on this PC (so the Auctions table and its filter see it at once), and a loan marked eligible is
  // "Auction Eligible" from then on, a sold one "Auctioned" — as the server will have it when the step is sent
  await queueWrite("POST", `/loans/${loanId}/auction/${step}`, body, undefined, () => Promise.reject(new Error("offline mode is not running")), async () => {
    setAuctionStage(loanId, stage);
    const status = step === "eligible" ? "Auction Eligible" : step === "sale" ? "Auctioned" : "";
    const rec = localLoanByNumericId(loanId);
    if (status && rec?.uuid) await upsertLocal("loans", { uuid: rec.uuid, status } as unknown as LocalRecord);
  });
  const base: AuctionRecordView = current ?? toAuctionRecordView({ id: 0, loanId, stage, notices: [], events: [], decisionRequests: [] } as unknown as BackendAuctionRecord);
  return { ...base, stage, ...patch };
}

export async function markAuctionEligible(loanId: number): Promise<AuctionRecordView> {
  const q = await auctionQueued(loanId, "eligible", undefined, "AuctionEligible");
  if (q) return q;
  return toAuctionRecordView(await apiFetch<BackendAuctionRecord>(`/loans/${loanId}/auction/eligible`, { method: "POST" }));
}

// issueAuctionNotice always fires all three notice channels (SMS, WhatsApp,
// Registered Post) at once — the backend no longer takes a method, it logs
// one AuctionNotice per channel and sends the WhatsApp message live.
export async function issueAuctionNotice(loanId: number, remarks?: string): Promise<AuctionRecordView> {
  const q = await auctionQueued(loanId, "notice", { remarks }, "NoticeIssued");
  if (q) return q;
  return toAuctionRecordView(
    await apiFetch<BackendAuctionRecord>(`/loans/${loanId}/auction/notice`, { method: "POST", body: JSON.stringify({ remarks }) })
  );
}

export async function scheduleAuction(loanId: number, auctionDate: string, referenceNumber?: string): Promise<AuctionRecordView> {
  const q = await auctionQueued(loanId, "schedule", { auctionDate, referenceNumber }, "AuctionScheduled", { auctionDate, auctionReferenceNumber: referenceNumber ?? "" } as Partial<AuctionRecordView>);
  if (q) return q;
  return toAuctionRecordView(
    await apiFetch<BackendAuctionRecord>(`/loans/${loanId}/auction/schedule`, { method: "POST", body: JSON.stringify({ auctionDate, referenceNumber }) })
  );
}

export async function recordAuctionSale(loanId: number, saleAmount: number, auctionExpenses: number, payment?: { cashAmount: number; upiAmount: number; bankTransferAmount: number; bankId?: number }): Promise<AuctionRecordView> {
  const q = await auctionQueued(loanId, "sale", { saleAmount, auctionExpenses, ...(payment ?? {}) }, "Auctioned", { saleAmount, auctionExpenses } as Partial<AuctionRecordView>);
  if (q) return q;
  return toAuctionRecordView(
    await apiFetch<BackendAuctionRecord>(`/loans/${loanId}/auction/sale`, { method: "POST", body: JSON.stringify({ saleAmount, auctionExpenses, ...(payment ?? {}) }) })
  );
}

/* settleAuction now disposes of a SURPLUS rather than recording a generic
 * settlement status. It is only reachable when the sale covered the debt in
 * full — a sale that left money owing raises a Shortfall decision instead (see
 * resolveAuctionDecision), and the backend rejects settling such a loan.
 *
 * "RefundedToCustomer" books a real cash-out; "RecordedAsIncome" books none
 * (the proceeds already entered the till at sale time) and requires remarks. */
export async function settleAuction(
  loanId: number,
  disposition: AuctionSurplusDisposition,
  remarks?: string,
  mode?: string,
  bankId?: number,
): Promise<AuctionRecordView> {
  const q = await auctionQueued(loanId, "settle", { disposition, remarks, mode, bankId }, "Settled", { surplusDisposition: disposition, surplusRemarks: remarks ?? "" } as Partial<AuctionRecordView>);
  if (q) return q;
  return toAuctionRecordView(
    await apiFetch<BackendAuctionRecord>(`/loans/${loanId}/auction/settle`, {
      method: "POST",
      body: JSON.stringify({ disposition, remarks, mode, bankId }),
    })
  );
}

/* --- Auction history & decisions ----------------------------------------- */

/* getAuctionHistory returns every case ever opened against a loan. A loan can
 * now accumulate several: one withdrawn after the customer caught up, another
 * after a later default. */
export async function getAuctionHistory(loanId: number): Promise<AuctionRecordView[]> {
  const recs = await apiFetch<BackendAuctionRecord[] | null>(`/loans/${loanId}/auction/history`);
  return (recs || []).map(toAuctionRecordView);
}

function toLedgerEntry(e: BackendLoanLedgerEntry): LoanLedgerEntry {
  const base = { key: e.key, date: e.date, amount: e.amount, part: e.part, component: e.component, mode: e.mode, accruing: e.accruing, paidThrough: e.paidThrough };
  const auction = e.auction ? toAuctionRecordView(e.auction) : null;
  switch (e.kind) {
    case "sanction":
      return { ...base, kind: "sanction", balance: e.balance ?? 0, payment: e.payment ? toPaymentView(e.payment) : null };
    case "payment":
      return { ...base, kind: "payment", balance: e.balance ?? 0, row: toPaymentView(e.payment!), auction };
    case "topup":
      return { ...base, kind: "topup", balance: e.balance ?? 0, row: e.topUp! };
    case "interest":
    case "penal":
    case "service-charge":
      return { ...base, kind: e.kind, balance: e.balance ?? 0 } as LoanLedgerEntry;
    case "auction-sale":
      return { ...base, kind: "auction-sale", balance: null, row: auction! };
    default:
      return { ...base, kind: "auction-surplus", balance: null, row: auction! };
  }
}

/* The ledger worked out from this PC's local copy of the loan, for when the server does not answer. It is the
 * same table (sanction, interest, payments, running balance), built from what the PC holds: the amounts, the
 * interest owed to date and every payment, including ones taken here that the server has not received yet. The
 * server's own dated interest rows, top-ups and auction rows come back when the server answers again. */
export function buildLocalLedger(rec: BackendLoan, q: LoanLedgerQuery): LoanLedgerPage {
  const rows: LoanLedgerEntry[] = [];
  // a payment taken on this PC has no server id (0), so ids alone put it before older ones from the same day; the moment
  // each was saved (createdAt) orders them, and the id only breaks a tie
  const payments = [...(rec.payments ?? [])].sort(
    (a, b) => (a.paidOn ?? "").slice(0, 10).localeCompare((b.paidOn ?? "").slice(0, 10)) || (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id - b.id,
  );
  const disbursement = payments.find((p) => p.type === "Disbursement") ?? null;
  const opened = (rec.disbursementDate || rec.openedDate || "").slice(0, 10);
  let balance = 0;
  const sanctioned = rec.status !== "Pending Approval" && rec.status !== "Rejected";
  const topUps = rec.localTopUps ?? [];
  if (sanctioned) {
    // the principal already includes any top-up taken here, which the ledger lists as its own row
    const original = rec.principalAmount - topUps.reduce((s, t) => s + t.amount, 0);
    balance += original;
    rows.push({ key: "sanction", date: opened, amount: original, kind: "sanction", balance, payment: disbursement ? toPaymentView(disbursement) : null });
    topUps.forEach((t, i) => {
      balance += t.amount;
      rows.push({ key: `topup-local-${i}`, date: t.occurredOn.slice(0, 10), amount: t.amount, kind: "topup", balance, row: t });
    });
    const interest = Math.max(rec.accruedInterest ?? 0, (rec.outstandingInterest ?? 0) + (rec.interestPaid ?? 0));
    if (interest > 0.004) {
      balance += interest;
      rows.push({ key: "interest-local", date: opened, amount: interest, kind: "interest", balance });
    }
    const penal = Math.max(rec.accruedPenalInterest ?? 0, (rec.outstandingPenalInterest ?? 0) + (rec.penalInterestPaid ?? 0));
    if (penal > 0.004) {
      balance += penal;
      rows.push({ key: "penal-local", date: opened, amount: penal, kind: "penal", balance });
    }
  }
  payments.forEach((p, i) => {
    if (p.type === "Disbursement") return;
    balance -= p.amount;
    rows.push({ key: `payment-${p.id || `local-${i}`}`, date: (p.paidOn ?? "").slice(0, 10), amount: p.amount, kind: "payment", balance, row: toPaymentView(p), auction: null });
  });
  const wanted = (kind: string) => !q.kinds?.length || q.kinds.includes(kind);
  const kept = rows.filter((r) => (!q.from || r.date >= q.from) && (!q.to || r.date <= q.to) && wanted(r.kind));
  const limit = q.limit > 0 ? q.limit : 100;
  const offset = q.offset >= 0 && q.offset < kept.length ? q.offset : 0;
  const keptDebit = kept.filter((r) => r.kind === "sanction" || r.kind === "topup" || r.kind === "interest" || r.kind === "penal").reduce((s, r) => s + r.amount, 0);
  const keptCredit = kept.filter((r) => r.kind === "payment").reduce((s, r) => s + r.amount, 0);
  return { items: kept.slice(offset, offset + limit), total: kept.length, limit, offset, totalDebit: keptDebit, totalCredit: keptCredit };
}

export async function getLoanLedger(loanId: number, q: LoanLedgerQuery, uuid?: string): Promise<LoanLedgerPage> {
  const localRec = () => (uuid ? (getLocal("loans", uuid) as unknown as BackendLoan | undefined) : undefined) ?? localLoanByNumericId(loanId);
  // a loan the server has not numbered yet has no ledger there; it is shown from the local copy
  if (offlineReady() && !loanId) {
    const rec = localRec();
    if (rec) return buildLocalLedger(rec, q);
  }
  const waiting = offlineReady() ? localRec() : undefined;
  if (waiting && (await hasWaitingChange(waiting.uuid)) && !(await loanChangesReplayable(waiting.uuid, loanId))) return buildLocalLedger(waiting, q);
  return orLocal(
    () => getLoanLedgerLive(loanId, q),
    () => {
      const rec = localRec();
      if (!rec) throw new ApiError("Ledger not available", 404);
      return buildLocalLedger(rec, q);
    },
  );
}

async function getLoanLedgerLive(loanId: number, q: LoanLedgerQuery): Promise<LoanLedgerPage> {
  const params = new URLSearchParams({ limit: String(q.limit), offset: String(q.offset) });
  if (q.from) params.set("from", q.from);
  if (q.to) params.set("to", q.to);
  if (q.kinds?.length) params.set("kinds", q.kinds.join(","));
  if (q.focusKey) params.set("focusKey", q.focusKey);
  if (q.focusDate) params.set("focusDate", q.focusDate);
  if (q.focusAmount !== undefined) params.set("focusAmount", String(q.focusAmount));
  const rec = await apiFetch<{ items: BackendLoanLedgerEntry[] | null; total: number; limit?: number; offset?: number; totalDebit?: number; totalCredit?: number }>(`/loans/${loanId}/ledger?${params}`);
  // limit/offset echo the page the server actually served (it may jump to a
  // focused row); fall back to the requested one if they're absent.
  return { items: (rec.items || []).map(toLedgerEntry), total: rec.total ?? 0, limit: rec.limit ?? q.limit, offset: rec.offset ?? q.offset, totalDebit: rec.totalDebit ?? 0, totalCredit: rec.totalCredit ?? 0 };
}

/* listConcludedAuctions backs the Auctions page's History tab — finished cases
 * (Settled or Withdrawn) across all loans, which previously disappeared from
 * view entirely once concluded. */
export async function listConcludedAuctions(): Promise<AuctionRecordView[]> {
  const recs = await apiFetch<BackendAuctionRecord[] | null>(`/loans/auctions/concluded`);
  return (recs || []).map(toAuctionRecordView);
}

/* Page size for the two History sub-tables on the Auctions screen. */
export const AUCTION_HISTORY_PAGE_SIZE = 10;

/* Paginated variant of listConcludedAuctions, filtered server-side by
 * whether the case actually sold gold (hasSale) — see
 * backend/internal/loan/repository.go's FindAllConcluded. Each of the two
 * History sub-tables ("Auctions Conducted" / "Closed Without Auction") calls
 * this with its own `hasSale` and its own `page` state, so paging one never
 * affects the other and a given page is never lopsided by the other
 * sub-table's rows. */
export async function listConcludedAuctionsPage(
  page: number,
  hasSale: boolean,
  limit?: number,
  q?: string,
  stages?: string[],
  outcome?: "surplus" | "shortfall" | ""
): Promise<{ items: ConcludedAuctionRowView[]; hasMore: boolean; total: number }> {
  const pageSize = limit ?? (isSmallScreen() ? 7 : 10);
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
    hasSale: String(hasSale),
  });
  if (q && q.trim()) params.set("q", q.trim());
  if (stages && stages.length) params.set("stage", stages.join(","));
  if (outcome) params.set("outcome", outcome);
  const rec = await apiFetch<{ items: BackendConcludedAuctionRow[]; hasMore: boolean; total?: number }>(
    `/loans/auctions/concluded?${params}`
  );
  return { items: (rec?.items || []).map(toConcludedAuctionRowView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
}

export async function listPendingAuctionDecisions(): Promise<AuctionDecisionRequestView[]> {
  const reqs = await apiFetch<BackendAuctionDecisionRequest[] | null>(`/loans/auctions/decisions/pending`);
  return (reqs || []).map((d) => ({
    id: d.id,
    auctionRecordId: d.auctionRecordId,
    loanId: d.loanId,
    kind: d.kind,
    amountPaid: roundRupee(d.amountPaid),
    outstandingAtRequest: roundRupee(d.outstandingAtRequest),
    status: d.status,
    decidedByRole: d.decidedByRole || "",
    decisionRemarks: d.decisionRemarks || "",
    createdAt: d.createdAt ? d.createdAt.slice(0, 10) : "",
    decidedAt: d.decidedAt ? d.decidedAt.slice(0, 10) : null,
  }));
}

/* resolveAuctionDecision applies a human ruling to an escalation. Valid
 * decisions depend on the request's kind, and the backend enforces both that
 * and the role authority — a Shortfall may only be decided by Branch Manager/
 * Management/Administrator, never by the Auction Administrator who raised it. */
export async function resolveAuctionDecision(
  loanId: number,
  requestId: number,
  decision: Exclude<AuctionDecisionStatus, "Pending">,
  remarks?: string,
): Promise<AuctionRecordView> {
  if (canQueue() && loanId > 0) {
    const current = await getAuctionRecord(loanId);
    await queueOnly("POST", `/loans/${loanId}/auction/decision`, { requestId, decision, remarks }, undefined);
    const base = current ?? toAuctionRecordView({ id: 0, loanId, stage: "AuctionEligible", notices: [], events: [], decisionRequests: [] } as unknown as BackendAuctionRecord);
    return { ...base, decisionRequests: base.decisionRequests.map((d) => (d.id === requestId ? { ...d, status: decision } : d)) };
  }
  return toAuctionRecordView(
    await apiFetch<BackendAuctionRecord>(`/loans/${loanId}/auction/decision`, {
      method: "POST",
      body: JSON.stringify({ requestId, decision, remarks }),
    })
  );
}

function toRequestView(r: BackendLoanRequest): RequestView {
  return {
    id: r.id,
    loanId: r.loan?.loanNumber || String(r.loanId),
    loanNumericId: r.loanId,
    loanNumber: r.loan?.loanNumber || String(r.loanId),
    customerName: r.loan?.customer?.name || "—",
    type: r.type,
    status: r.status,
    detail: r.detail,
    requestedAt: r.requestedAt ? r.requestedAt.slice(0, 10) : "",
    remarks: r.remarks,
    requestedExtensionMonths: r.requestedExtensionMonths ?? null,
    approvalStage: r.approvalStage || "",
    isPartial: r.isPartial,
    customerSawGold: r.customerSawGold,
    paymentRecorded: r.paymentRecorded,
    locked: r.locked,
    verificationNotes: r.verificationNotes,
    charges: r.charges,
    chargesApplied: r.chargesApplied ?? 0,
    settlementAmount: r.settlementAmount,
    recordedDiscount: r.recordedDiscount ?? 0,
    recordedPayment: r.recordedPayment ?? 0,
    paymentDueDate: r.paymentDueDate ? r.paymentDueDate.slice(0, 10) : null,
    ornamentIds: (r.ornamentSelections || []).map((s) => s.ornamentId),
    syncPending: (r as { syncPending?: boolean }).syncPending,
  };
}

/* A decision on an existing request (verify, approve, reject, record payment) goes into the outbox first and the sender
 * posts it. Requests are addressed by their server id, so one made offline (id 0) has to be sent before it can be
 * decided. The screen gets the request back with what it can know locally (a rejection is final) and "syncPending",
 * which the list shows as "Sending". Returns null when this is not the desktop app, so the caller makes the request. */
async function queueRequestAction(
  requestId: number,
  method: "POST" | "PUT",
  path: string,
  body: unknown,
  current: RequestView | undefined,
  patch: Partial<RequestView>,
  // the loan as it is once this decision is applied (a payment, a closure, a new due date), kept in the local copy
  local?: { uuid: string; after: BackendLoan },
): Promise<RequestView | null> {
  if (!offlineReady()) return null;
  // a request made on this PC that has no entry to point at: the server has no such request to act on, so say so clearly
  // instead of sending a request for /requests/0 to the server
  if (requestId === 0) throw new ApiError("This request has not reached the server yet. Try again in a moment, once it has synced.", 409);
  // a request made on this PC and not sent yet is addressed by the entry that creates it (see requestRef.ts)
  if (requestId < 0) {
    const found = await findLocalRequest(requestId);
    if (!found) return null;
    path = path.replace(`/requests/${requestId}/`, `/requests/${"entryId" in found ? `ref:${found.entryId}` : found.serverId}/`);
  }
  const entry = newEntry(method, path, body, currentActor(), local ? [`request:${requestId}`, local.uuid] : [`request:${requestId}`]);
  // what the request looks like meanwhile, so a reload of the list does not show it as it was
  entry.view = patch as Record<string, unknown>;
  await enqueueAndWait(
    entry,
    () => (local ? upsertLocal("loans", { ...local.after, uuid: local.uuid } as unknown as LocalRecord) : undefined),
    () => undefined,
  );
  const base: RequestView = current ?? {
    id: requestId, loanId: "", loanNumericId: 0, loanNumber: "", customerName: "—", type: "Extension", status: "Pending", detail: "",
    requestedAt: "", remarks: "", requestedExtensionMonths: null, approvalStage: "", isPartial: false, customerSawGold: false,
    paymentRecorded: false, locked: false, verificationNotes: "", charges: 0, chargesApplied: 0, settlementAmount: 0,
    recordedDiscount: 0, recordedPayment: 0, paymentDueDate: null, ornamentIds: [],
  };
  return { ...base, ...patch, syncPending: true };
}

/* --- Release and extension decisions made while the server does not answer ----------------------------------------------
 * Each one is checked here the way the server checks it and applied to the local loan and to the request, so a payment
 * cannot be taken twice for the same release and an approved request shows as closed (with the loan closed, ornaments
 * released or the due date moved) without waiting for the send. */

const decided = (r: RequestView) => r.status !== "Pending" || r.approvalStage === "Approved" || r.approvalStage === "Rejected";
const roundMoney = (n: number) => Math.round(n * 100) / 100;

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* The loan once an approved release has been carried out: closed for a full release, the chosen ornaments handed back for a partial one. */
function releasedLoan(loan: BackendLoan, req: RequestView): BackendLoan {
  const now = new Date().toISOString();
  if (!req.isPartial) return { ...loan, status: "Closed", updatedAt: now };
  return {
    ...loan,
    ornaments: (loan.ornaments ?? []).map((o) => (req.ornamentIds.includes(o.id) && !(o as { releasedAt?: string }).releasedAt ? { ...o, releasedAt: now } : o)),
    updatedAt: now,
  };
}

/* A release request moved on by one stage of this business's chain; past the last stage (or with the chain off) it is approved and
 * carried out. A full release that is not paid in full cannot be carried out: approving it is refused (strict), and a payment that
 * leaves a balance simply leaves the request where it is. */
async function releaseAdvance(req: RequestView, loan: BackendLoan, strict: boolean): Promise<{ patch: Partial<RequestView>; loan: BackendLoan }> {
  const workflow = await fetchApprovalWorkflow().catch(() => []);
  const cur = stageByPending(workflow, "loan_release", req.approvalStage);
  const following = cur ? nextStage(workflow, "loan_release", cur.key) : null;
  if (following) return { patch: { approvalStage: following.pending }, loan };
  if (!req.isPartial && (loan.totalOutstandingBalance ?? 0) > 0.01) {
    if (strict) throw new ApiError("settlement is not fully paid yet", 400);
    return { patch: {}, loan };
  }
  return {
    patch: { status: "Approved", approvalStage: "Approved", settlementAmount: roundMoney((loan.totalOutstandingBalance ?? 0) + req.charges) },
    loan: releasedLoan(loan, req),
  };
}

/* A loan with its due date moved on by an approved extension. */
function extendedLoan(loan: BackendLoan, months: number): BackendLoan {
  const due = loan.dueDate ?? "";
  const [y, m, d] = due.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return loan;
  const moved = new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
  const overdue = moved < localToday();
  return {
    ...loan,
    dueDate: moved + due.slice(10),
    isOverdue: overdue,
    isDueSoon: false,
    daysOverdue: overdue ? loan.daysOverdue : 0,
    status: !overdue && ["Overdue", "Due Soon"].includes(loan.status) ? "Active" : loan.status,
    updatedAt: new Date().toISOString(),
  };
}

/* What recording a release payment does here: the discount then the payment land on the loan (the same refusals the server
 * gives, so a payment cannot be taken twice for the same release), and the request moves on a stage after its first payment. */
async function planReleasePayment(req: RequestView, loan: BackendLoan, input: ReleasePaymentInput): Promise<{ patch: Partial<RequestView>; loan: BackendLoan }> {
  if (req.type !== "Release") throw new ApiError("this request is not a Release request", 400);
  if (decided(req)) throw new ApiError("loan request has already been decided", 400);
  const pastManagerForDriftTopUp = req.isPartial && req.locked;
  if (req.approvalStage !== "" && req.approvalStage !== "PendingManager" && !pastManagerForDriftTopUp) {
    throw new ApiError("payment is only taken at manager review", 400);
  }
  const discount = input.discount ?? 0;
  if (discount < 0 || input.amount < 0) throw new ApiError("amount must be greater than zero", 400);
  const actor = currentActor();
  const paidOn = localToday();
  const chargeDelta = Math.max(0, roundMoney(req.charges - req.chargesApplied));
  const paymentAmount = chargeDelta > 0.01 && input.amount <= 0 ? chargeDelta : input.amount;

  let next = loan;
  if (discount > 0) next = applyPaymentLocally(next, { amount: discount, type: "Discount", paidOn, description: "Release discount" }, actor);
  if (paymentAmount > 0) {
    next = applyPaymentLocally(next, {
      amount: paymentAmount, type: input.type || "Partial", processingFee: chargeDelta || undefined, paidOn,
      cashAmount: input.cashAmount, upiAmount: input.upiAmount, bankTransferAmount: input.bankTransferAmount, chequeAmount: input.chequeAmount,
      bankId: input.bankId, reference: input.reference, interestOverride: input.interestOverride, description: "Release payment",
    }, actor);
  }
  // The server checks the payment (plus discount) against what is needed to release the gold, from the live balance. Interest only adds to
  // that balance, so a payment already short of what this PC shows is certainly short on the server; the opposite (a discount above what
  // is needed) is left to the server, whose balance may be higher.
  {
    const view = toView(loan);
    const kept = req.isPartial ? view.ornaments.filter((o) => !o.releasedAt && !(req.ornamentIds ?? []).includes(o.id)).map((o) => o.id) : null;
    const needed = releaseAmountNeeded(view, kept);
    // whole rupees, as the server (RoundMoney): ₹0.20 under the figure is not "short"
    const short = roundRupee(needed - (input.amount + discount));
    if (short > 0.01) throw new ApiError(`the payment is ₹${short.toFixed(2)} short of the ₹${needed.toFixed(2)} needed to release the gold`, 400);
  }
  const settled = req.isPartial || (next.totalOutstandingBalance ?? 0) <= 0.01;
  if (!settled && (discount > 0 || paymentAmount > 0) && !input.dueDate) throw new ApiError("due date is required", 400);
  let patch: Partial<RequestView> = {
    paymentRecorded: true,
    locked: true,
    recordedPayment: roundMoney(req.recordedPayment + input.amount),
    recordedDiscount: roundMoney(req.recordedDiscount + discount),
    chargesApplied: paymentAmount > 0 ? roundMoney(req.chargesApplied + chargeDelta) : req.chargesApplied,
    paymentDueDate: settled ? null : input.dueDate ?? null,
  };
  // the first payment (or one taken while still at the payment stage) moves the request on, as the server does
  if (!req.paymentRecorded || req.approvalStage === "" || req.approvalStage === "PendingManager") {
    const adv = await releaseAdvance({ ...req, ...patch }, next, false);
    patch = { ...patch, ...adv.patch };
    next = adv.loan;
  }
  return { patch, loan: next };
}

/* What approving or rejecting a release request does here. */
async function planReleaseDecision(req: RequestView, loan: BackendLoan | undefined, input: ReleaseApprovalInput): Promise<{ patch: Partial<RequestView>; loan?: BackendLoan }> {
  if (req.type !== "Release") throw new ApiError("this request is not a Release request", 400);
  if (decided(req)) throw new ApiError("loan request has already been decided", 400);
  if (input.action === "Rejected") {
    if (req.locked) throw new ApiError("release request is locked after payment", 409);
    return { patch: { status: "Rejected", approvalStage: "Rejected" } };
  }
  const needsBoth = new ApiError('"Customer has seen the gold" must be ticked and a payment recorded before this can be approved', 400);
  if (!req.customerSawGold) throw needsBoth;
  if (!req.paymentRecorded) {
    // a loan can already meet the release's condition without a payment on this request
    let met = false;
    if (loan) {
      if (req.isPartial) {
        const remaining = (loan.ornaments ?? []).filter((o) => !(o as { releasedAt?: string }).releasedAt && !req.ornamentIds.includes(o.id)).reduce((s, o) => s + o.goldValue, 0);
        met = (loan.totalOutstandingBalance ?? 0) - (remaining * (loan.schemeLtvPercent ?? 0)) / 100 <= 0.01;
      } else {
        met = (loan.totalOutstandingBalance ?? 0) <= 0.01;
      }
    }
    if (!met) throw needsBoth;
  }
  if (!loan) return { patch: { approvalStage: req.approvalStage } };
  const adv = await releaseAdvance(req, loan, true);
  return { patch: adv.patch, loan: adv.loan };
}

/* What approving or rejecting an extension request does here. */
async function planExtensionDecision(req: RequestView, loan: BackendLoan | undefined, input: ExtensionApprovalInput): Promise<{ patch: Partial<RequestView>; loan?: BackendLoan }> {
  if (req.type !== "Extension") throw new ApiError("this request is not an Extension request", 400);
  if (decided(req)) throw new ApiError("loan request has already been decided", 400);
  if (input.action === "Rejected") return { patch: { status: "Rejected", approvalStage: "Rejected" } };
  if (loan && ((loan.outstandingInterest ?? 0) > 0.01 || (loan.outstandingPenalInterest ?? 0) > 0.01)) throw new ApiError("pay the outstanding interest first", 400);
  const workflow = await fetchApprovalWorkflow().catch(() => []);
  const following = nextStage(workflow, "loan_extension", input.stage);
  if (following) return { patch: { approvalStage: following.pending } };
  if (loan && ["Closed", "Rejected", "Auctioned", "Auctioned (Balance Due)"].includes(loan.status)) throw new ApiError("loan is closed — nothing to extend", 400);
  return { patch: { status: "Approved", approvalStage: "Approved" }, loan: loan ? extendedLoan(loan, req.requestedExtensionMonths ?? 0) : undefined };
}

export async function listLoanRequests(filters?: LoanRequestFilters): Promise<RequestView[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.loanId) params.set("loan_id", String(filters.loanId));
  const qs = params.toString();
  const rec = await apiFetch<BackendLoanRequest[]>(`/loans/requests${qs ? `?${qs}` : ""}`);
  return (rec || []).map(toRequestView);
}

export const REQUESTS_TABLE_PAGE_SIZE = 10;

/* Paginated variant of listLoanRequests for the Requests page table — same
 * {items, hasMore} envelope as listLoansPage, keyed off `page` (1-based). */
export async function listLoanRequestsPage(
  page: number,
  filters?: LoanRequestFilters,
  limit?: number
): Promise<{ items: RequestView[]; hasMore: boolean; total: number }> {
  const pageSize = limit ?? (isSmallScreen() ? 7 : 10);
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
  });
  if (filters?.status) params.set("status", filters.status);
  if (filters?.loanId) params.set("loan_id", String(filters.loanId));
  if (filters?.type) params.set("type", filters.type);
  if (filters?.q) params.set("q", filters.q);
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  const rec = await apiFetch<{ items: BackendLoanRequest[]; hasMore: boolean; total?: number }>(`/loans/requests?${params}`);
  return { items: (rec?.items || []).map(toRequestView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
}

/* The loan number the next created loan will get (highest ever issued + 1,
 * hard-deleted loans included) — New Loan's "Loan No (auto)" preview. */
export async function getNextLoanNumber(): Promise<string> {
  const rec = await apiFetch<{ loanNumber: string }>("/loans/next-number");
  return rec.loanNumber;
}

/* Backs Dashboard.tsx's "Interest Collected" KPI — replaces the old
 * always-empty `db.ledger` mock figure. Defaults (server-side) to the
 * current calendar month when `from`/`to` are omitted. */
export async function getInterestCollected(from?: string, to?: string): Promise<number> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  const rec = await apiFetch<{ interestCollected: number }>(`/loans/interest-collected${qs ? `?${qs}` : ""}`);
  return rec.interestCollected;
}

// RISK_STATUSES mirrors backend/internal/loan/service.go's
// riskEligibleStatuses exactly — the loan statuses where gold is still in
// custody and a real principal is still owed against it. Backs the risk
// page's own status filter dropdown.
export const RISK_STATUSES = ["Active", "Due Soon", "Overdue", "Closure Requested", "Defaulted", "Auction Eligible"] as const;

export const LOAN_RISK_PAGE_SIZE = 15;

export async function listLoanRiskAssessmentPage(
  page: number,
  limit?: number,
  filters?: { status?: string; riskLevel?: string; fromDate?: string; toDate?: string; q?: string }
): Promise<{ items: LoanRiskRow[]; hasMore: boolean; total: number; counts: LoanRiskCounts }> {
  const pageSize = limit ?? LOAN_RISK_PAGE_SIZE;
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
  });
  if (filters?.status) params.set("status", filters.status);
  if (filters?.riskLevel) params.set("risk_level", filters.riskLevel);
  if (filters?.fromDate) params.set("from", filters.fromDate);
  if (filters?.toDate) params.set("to", filters.toDate);
  if (filters?.q?.trim()) params.set("search", filters.q.trim());
  const rec = await apiFetch<{ items: LoanRiskRow[]; hasMore: boolean; total: number; counts: LoanRiskCounts }>(`/loans/risk-assessment?${params}`);
  return { items: rec?.items || [], hasMore: !!rec?.hasMore, total: rec?.total ?? 0, counts: rec?.counts ?? { loss: 0, atRisk: 0, safe: 0 } };
}

/* Offline, a second pending request of the same kind for one loan is refused here, as the server would (it answers "a release is
 * already requested"); otherwise the same request could be saved again and again and all of them sent on reconnect. Pending
 * requests are read from the list, which already includes the ones waiting to be sent from this PC. */
async function refuseSecondPending(loanId: number, type: "Extension" | "Release"): Promise<void> {
  if (!offlineReady() || !loanId) return;
  const pending = await listLoanRequests({ loanId, status: "Pending" }).catch(() => [] as RequestView[]);
  if (pending.some((r) => r.type === type)) {
    throw new ApiError(type === "Release" ? "a release is already requested for this loan" : "an extension is already requested for this loan", 409);
  }
}

export async function createExtensionRequest(loanId: number, months: number, detail?: string): Promise<RequestView> {
  if (offlineReady() && loanId) {
    const known = localLoanByNumericId(loanId);
    if (known) checkRequestLocally(known, "Extension", months);
  }
  await refuseSecondPending(loanId, "Extension");
  // The server's own rule ("pay the outstanding interest first"), checked on this PC's copy so the request is not queued only to be refused.
  if (offlineReady()) {
    const rec = localLoanByNumericId(loanId);
    if (rec && ((rec.outstandingInterest ?? 0) > 0.01 || (rec.outstandingPenalInterest ?? 0) > 0.01)) throw new ApiError("pay the outstanding interest first", 400);
  }
  // With no extension approval stages the server approves it on the spot and moves the due date; the local copy does the same
  const autoApproved = offlineReady() && !!localLoanByNumericId(loanId)?.uuid && isFlowOff(await fetchApprovalWorkflow().catch(() => []), "loan_extension");
  if (autoApproved) {
    const rec = localLoanByNumericId(loanId)!;
    if (["Closed", "Rejected", "Auctioned", "Auctioned (Balance Due)"].includes(rec.status)) throw new ApiError("loan is closed — nothing to extend", 400);
  }
  const queued = await queueFirst(
    loanId, "/extension-request", "POST", { months, detail },
    autoApproved ? (loan) => extendedLoan(loan, months) : undefined,
    autoApproved ? { status: "Approved", approvalStage: "Approved" } : undefined,
  );
  if (queued) return toRequestView({ id: 0, loanId, loan: queued, type: "Extension", status: autoApproved ? "Approved" : "Pending", approvalStage: autoApproved ? "Approved" : "", requestedBy: "Staff", detail: detail ?? "", requestedExtensionMonths: months } as unknown as BackendLoanRequest);
  const rec = await apiFetch<BackendLoanRequest>(`/loans/${loanId}/extension-request`, {
    method: "POST",
    body: JSON.stringify({ months, detail }),
  });
  return toRequestView(rec);
}

/* ornamentIds selects a Partial Ornament Release's subset of the loan's
 * currently-pledged ornaments — omit (or pass every pledged ornament's id)
 * for a full release, unchanged from before this parameter existed; the
 * backend forces IsPartial back to false itself when every ornament is
 * selected (see CreateReleaseRequest's own doc comment), so the caller
 * doesn't need to special-case "select all" as anything but a normal call. */
export async function createReleaseRequest(loanId: number, detail?: string, ornamentIds?: number[], requestedAt?: string): Promise<RequestView> {
  const body = { detail, ornamentIds: ornamentIds && ornamentIds.length ? ornamentIds : undefined, requestedAt };
  if (offlineReady() && loanId) {
    const known = localLoanByNumericId(loanId);
    if (known) checkRequestLocally(known, "Release");
  }
  await refuseSecondPending(loanId, "Release");
  const queued = await queueFirst(loanId, "/release-request", "POST", body);
  if (queued) {
    // what the server will work out when it logs the request: the whole-rupee amount needed to release this gold (every ornament
    // chosen is a full release), plus any charges (none yet). The toast and the lists show it before the send.
    const view = toView(queued);
    const active = view.ornaments.filter((o) => !o.releasedAt);
    const picked = ornamentIds ?? [];
    const partial = picked.length > 0 && picked.length < active.length;
    const kept = partial ? active.filter((o) => !picked.includes(o.id)).map((o) => o.id) : null;
    return toRequestView({
      id: 0, loanId, loan: queued, type: "Release", status: "Pending", requestedBy: "Staff", detail: detail ?? "", ...(requestedAt ? { requestedAt } : {}),
      isPartial: partial, charges: 0, settlementAmount: releaseAmountNeeded(view, kept),
      ornamentSelections: partial ? picked.map((ornamentId) => ({ ornamentId })) : [],
    } as unknown as BackendLoanRequest);
  }
  const rec = await apiFetch<BackendLoanRequest>(`/loans/${loanId}/release-request`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return toRequestView(rec);
}

/* Extension-only decision — one step, mirrors DecideRequest on the backend.
 * Release requests use verifyReleaseChecklist + approveReleaseRequest
 * instead (the backend rejects a Release request here with
 * ErrNotExtensionRequest). */
// employeeId is NOT sent — the backend derives the deciding employee's
// identity from the authenticated JWT (see platform.ActorFromContext).
export async function decideRequest(requestId: number, action: "Approved" | "Rejected", remarks?: string, current?: RequestView): Promise<RequestView> {
  const queued = await queueRequestAction(requestId, "PUT", `/loans/requests/${requestId}/decide`, { action, remarks }, current, action === "Rejected" ? { status: "Rejected" } : {});
  if (queued) return queued;
  const rec = await apiFetch<BackendLoanRequest>(`/loans/requests/${requestId}/decide`, {
    method: "PUT",
    body: JSON.stringify({ action, remarks }),
  });
  return toRequestView(rec);
}

export async function verifyReleaseChecklist(requestId: number, input: ChecklistInput, current?: RequestView): Promise<RequestView> {
  const queued = await queueRequestAction(requestId, "PUT", `/loans/requests/${requestId}/verify`, input, current, {
    ...(input.customerSawGold !== undefined ? { customerSawGold: input.customerSawGold } : {}),
    ...(input.verificationNotes !== undefined ? { verificationNotes: input.verificationNotes } : {}),
  });
  if (queued) return queued;
  const rec = await apiFetch<BackendLoanRequest>(`/loans/requests/${requestId}/verify`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return toRequestView(rec);
}

export async function recordReleasePayment(requestId: number, input: ReleasePaymentInput, current?: RequestView): Promise<RequestView> {
  const loan = offlineReady() && requestId !== 0 && current ? localLoanByNumericId(current.loanNumericId) : undefined;
  const plan = current && loan?.uuid ? await planReleasePayment(current, loan, input) : null;
  const queued = await queueRequestAction(
    requestId, "POST", `/loans/requests/${requestId}/release-payment`, input, current, plan?.patch ?? { paymentRecorded: true },
    plan && loan?.uuid ? { uuid: loan.uuid, after: plan.loan } : undefined,
  );
  if (queued) return queued;
  const rec = await apiFetch<BackendLoanRequest>(`/loans/requests/${requestId}/release-payment`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toRequestView(rec);
}

export async function approveReleaseRequest(requestId: number, input: ReleaseApprovalInput, current?: RequestView): Promise<RequestView> {
  const loan = offlineReady() && current ? localLoanByNumericId(current.loanNumericId) : undefined;
  const plan = current && offlineReady() && requestId !== 0 ? await planReleaseDecision(current, loan, input) : null;
  const queued = await queueRequestAction(
    requestId, "POST", `/loans/requests/${requestId}/approve`, input, current, plan?.patch ?? (input.action === "Rejected" ? { status: "Rejected" } : {}),
    plan?.loan && loan?.uuid ? { uuid: loan.uuid, after: plan.loan } : undefined,
  );
  if (queued) return queued;
  const rec = await apiFetch<BackendLoanRequest>(`/loans/requests/${requestId}/approve`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toRequestView(rec);
}

export async function approveExtensionRequest(requestId: number, input: ExtensionApprovalInput, current?: RequestView): Promise<RequestView> {
  const loan = offlineReady() && current ? localLoanByNumericId(current.loanNumericId) : undefined;
  const plan = current && offlineReady() && requestId !== 0 ? await planExtensionDecision(current, loan, input) : null;
  const queued = await queueRequestAction(
    requestId, "POST", `/loans/requests/${requestId}/approve`, input, current, plan?.patch ?? (input.action === "Rejected" ? { status: "Rejected" } : {}),
    plan?.loan && loan?.uuid ? { uuid: loan.uuid, after: plan.loan } : undefined,
  );
  if (queued) return queued;
  const rec = await apiFetch<BackendLoanRequest>(`/loans/requests/${requestId}/approve`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toRequestView(rec);
}

/* The actual "hand the gold back" step, separate from approving the
 * request — blocked server-side until the settlement is fully paid and any
 * bank pledge already released (see Service.CompleteRelease). */
// No employeeId needed — the backend derives it from the authenticated JWT
// (see platform.ActorFromContext).
export async function completeRelease(loanId: number): Promise<LoanView> {
  // Desktop: a loan already paid in full is closed here at once and the release is sent later. One that still needs the
  // server's approved release request goes to the server as before.
  if (offlineReady() && !loanId) throw new ApiError(NOT_SENT, 409);
  const local = offlineReady() ? localLoanByNumericId(loanId) : undefined;
  if (local?.uuid && (local.totalOutstandingBalance ?? 0) <= 0.01) {
    if (local.bankPledgeStatus === "Bank Pledged" || (local.bankPledges ?? []).some((p) => (p.status || "Active") === "Active")) {
      throw new ApiError("release the bank pledge first", 400);
    }
    const queued = await queueFirst(loanId, "/complete-release", "POST", undefined, (loan) => ({ ...loan, status: "Closed", updatedAt: new Date().toISOString() }));
    if (queued) return toView(queued);
  }
  const rec = await apiFetch<BackendLoan>(`/loans/${loanId}/complete-release`, {
    method: "POST",
  });
  return toView(rec);
}

/* --- Ledger edit / delete -------------------------------------------------
 * Editing or deleting a payment or discount recalculates the whole loan on the
 * server (interest, every later payment's split, balances, status, cash lines)
 * in one transaction. dryRun asks for the before/after figures without saving. */
import type { InterestChangeView } from "@/modules/loans/components/InterestChangesTable";
export type LedgerLoanSummary = { principal: number; interest: number; penalInterest: number; fee: number; total: number; status: string };
/* Offered when a repayment edit reopens a closed loan: the packet can go back to the status it had before. */
export type PacketReversalOffer = { packetId: number; code: string; currentStatus: string; previousStatus: string; lockerId?: number };
/* What a gold release did that an edit may need to undo — each is offered with a box, and the ticked ones are undone in
 * the same save as the edit. `warning` is something to know before ticking it (e.g. the locker is full). */
export type LedgerEditDependent = { kind: "packet" | "partial_release"; description: string; current: string; suggested: string; warning?: string };
export type LedgerEditPreview = {
  before: LedgerLoanSummary; after: LedgerLoanSummary; dryRun: boolean;
  packet?: PacketReversalOffer;
  following?: LedgerFollowingEntry[]; // later payments that no longer fit, and what each can still be
  interestChanges?: InterestChangeView[]; // interest charges the edit changes — worked out, shown only
};
/* A payment edit's preview also lists what a gold release did that the edit may undo. */
/* A later payment that no longer fits once an earlier one is edited: what it can still be (0 = it would be removed). */
export type LedgerFollowingEntry = { id: number; paidOn: string; type?: string; reference?: string; current: number; suggested: number; needsChange?: boolean };
export type LedgerPaymentEditPreview = LedgerEditPreview & { dependents?: LedgerEditDependent[]; following?: LedgerFollowingEntry[] };
export type LedgerGoldChoices = { reversePacket?: boolean; restorePartialRelease?: boolean };
export type EditLedgerPaymentInput = LedgerGoldChoices & {
  adjustFollowing?: { id: number; amount: number }[]; // the amounts chosen for the later payments that no longer fit
  paidOn?: string;
  amount?: number;
  type?: string;
  cashAmount?: number;
  upiAmount?: number;
  bankTransferAmount?: number;
  chequeAmount?: number;
  bankId?: number; // the bank for the UPI / Bank Transfer part
  reference?: string;
  description?: string;
  discountReason?: string; // Discount rows only
  discountMode?: string; // Discount rows only
  discountKind?: string; // Discount rows only: customer / interest / penal_interest
  processingFee?: number; // the additional charge collected with this payment
  discount?: number; // the discount given with this payment (0 removes it)
  reason?: string;
};

/* The discount that was given together with a repayment: the one saved against it, or — for a payment recorded before
 * discounts were linked — one saved for the same day right before it. */
export function linkedDiscountOf(payments: PaymentView[], p: PaymentView): PaymentView | undefined {
  const linked = payments.find((d) => d.type === "Discount" && d.linkedPaymentId === p.id);
  if (linked) return linked;
  return payments.find((d) => d.type === "Discount" && !d.linkedPaymentId && d.paidOn === p.paidOn && d.id < p.id && p.id - d.id <= 1);
}

export async function editLedgerPayment(loanId: number, paymentId: number, input: EditLedgerPaymentInput, dryRun = false): Promise<LedgerPaymentEditPreview> {
  if (!dryRun && canQueue() && paymentId < 0) return editWaitingLoanPayment(loanId, paymentId, input);
  if (!dryRun && canQueue()) return queueOnly("PATCH", `/loans/${loanId}/payments/${paymentId}`, input, { dryRun: false } as unknown as LedgerPaymentEditPreview);
  return apiFetch<LedgerPaymentEditPreview>(`/loans/${loanId}/payments/${paymentId}${dryRun ? "?dry_run=true" : ""}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

/* Top-up edit / delete — the loan is recalculated from its first day with every top-up applied on its date. */
export type EditTopUpInput = LedgerGoldChoices & {
  adjustFollowing?: { id: number; amount: number }[];
  occurredOn?: string;
  amount?: number;
  cashAmount?: number;
  upiAmount?: number;
  bankTransferAmount?: number;
  bankId?: number;
  reference?: string;
  reason?: string;
};

export async function editLoanTopUp(loanId: number, topUpId: number, input: EditTopUpInput, dryRun = false): Promise<LedgerPaymentEditPreview> {
  if (!dryRun && canQueue()) return queueOnly("PATCH", `/loans/${loanId}/top-ups/${topUpId}`, input, { dryRun: false } as unknown as LedgerPaymentEditPreview);
  return apiFetch<LedgerPaymentEditPreview>(`/loans/${loanId}/top-ups/${topUpId}${dryRun ? "?dry_run=true" : ""}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

/* Sanction (disbursement) edit — applied at once; the loan is recalculated from its first day. */
export type EditLoanDisbursementInput = LedgerGoldChoices & {
  adjustFollowing?: { id: number; amount: number }[];
  disbursedOn?: string;
  dueDate?: string;
  sanctionedAmount?: number;
  serviceCharge?: number;
  cashAmount?: number;
  upiAmount?: number;
  bankTransferAmount?: number;
  bankId?: number;
  reason?: string;
};

export async function editLoanDisbursement(loanId: number, input: EditLoanDisbursementInput, dryRun = false): Promise<LedgerPaymentEditPreview> {
  if (!dryRun && canQueue()) return queueOnly("PATCH", `/loans/${loanId}/disbursement`, input, { dryRun: false } as unknown as LedgerPaymentEditPreview);
  return apiFetch<LedgerPaymentEditPreview>(`/loans/${loanId}/disbursement${dryRun ? "?dry_run=true" : ""}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteLoanTopUp(loanId: number, topUpId: number, dryRun = false, reason?: string, gold: LedgerGoldChoices = {}): Promise<LedgerPaymentEditPreview> {
  if (!dryRun && canQueue()) {
    const q = new URLSearchParams({ ...(reason ? { reason } : {}), ...(gold.reversePacket ? { reverse_packet: "true" } : {}), ...(gold.restorePartialRelease ? { restore_partial_release: "true" } : {}) }).toString();
    return queueOnly("DELETE", `/loans/${loanId}/top-ups/${topUpId}${q ? `?${q}` : ""}`, undefined, { dryRun: false } as unknown as LedgerPaymentEditPreview);
  }
  return apiFetch<LedgerPaymentEditPreview>(`/loans/${loanId}/top-ups/${topUpId}?${new URLSearchParams({ ...(reason ? { reason } : {}), ...(dryRun ? { dry_run: "true" } : {}), ...(gold.reversePacket ? { reverse_packet: "true" } : {}), ...(gold.restorePartialRelease ? { restore_partial_release: "true" } : {}) })}`, {
    method: "DELETE",
  });
}

export async function deleteLedgerPayment(loanId: number, paymentId: number, dryRun = false, reason?: string, gold: LedgerGoldChoices = {}): Promise<LedgerPaymentEditPreview> {
  if (!dryRun && canQueue() && paymentId < 0) return deleteWaitingLoanPayment(loanId, paymentId);
  if (!dryRun && canQueue()) {
    const q = new URLSearchParams({ ...(reason ? { reason } : {}), ...(gold.reversePacket ? { reverse_packet: "true" } : {}), ...(gold.restorePartialRelease ? { restore_partial_release: "true" } : {}) }).toString();
    return queueOnly("DELETE", `/loans/${loanId}/payments/${paymentId}${q ? `?${q}` : ""}`, undefined, { dryRun: false } as unknown as LedgerPaymentEditPreview);
  }
  return apiFetch<LedgerPaymentEditPreview>(`/loans/${loanId}/payments/${paymentId}?${new URLSearchParams({ ...(reason ? { reason } : {}), ...(dryRun ? { dry_run: "true" } : {}), ...(gold.reversePacket ? { reverse_packet: "true" } : {}), ...(gold.restorePartialRelease ? { restore_partial_release: "true" } : {}) })}`, {
    method: "DELETE",
  });
}

/* Mirrors backend/internal/loan's bankPledgeIneligibleStatuses /
 * CanAcceptBankPledge — the loan statuses whose gold is no longer the
 * branch's to hand to a bank, so no re-pledge entry point should offer them.
 *
 * "Closed" is gold already released back to the customer; "Rejected" was
 * turned down before disbursement; "Closure
 * Requested" has the release in flight and committed; the two auctioned
 * states mean the gold has been sold; "Pending Approval" was never
 * disbursed.
 *
 * Kept in sync by hand: the server enforces the same rule in
 * Service.RecordBankPledge, so a stale copy here degrades to an error toast
 * rather than a bad write. */
const BANK_PLEDGE_INELIGIBLE_STATUSES = [
  "Rejected",
  "Closed",
  "Closure Requested",
  "Auctioned",
  "Auctioned - Balance Due",
  "Pending Approval",
];

/* Only an OPEN pledge blocks a new one: "Bank Pledged" means one is still out
 * with a bank, while "Released" means the gold came BACK from the bank and is
 * in the branch's custody again — that loan may be pledged afresh, as many
 * times as its life allows. (An earlier rule made a pledge once-per-loan for
 * its lifetime; it was dropped — see backend bankPledgeRefusal.) Pass both
 * values: a loan needs an eligible status AND no pledge currently open. */
export function canAcceptBankPledge(status: string, bankPledgeStatus: string): boolean {
  return (
    !BANK_PLEDGE_INELIGIBLE_STATUSES.includes(status) &&
    bankPledgeStatus !== "Bank Pledged"
  );
}

/* Downloads the customer-facing account statement PDF for one loan.
 *
 * Uses a raw fetch rather than apiFetch because the response is a PDF, not
 * the JSON envelope apiFetch parses — the same reason reportsService's
 * exportReport does, and this deliberately mirrors that helper so there is
 * one recognisable shape for "authenticated binary download" in the app.
 *
 * The filename comes from the server's Content-Disposition, so the loan
 * number in it always matches the document's contents. */
export async function downloadLoanStatement(loanId: number, uuid?: string): Promise<void> {
  // a loan this PC made and the server has not numbered yet exists only here: its statement is made here too
  if (!loanId && uuid && canRenderOffline()) return printOfflineLoanDocument("statement", 0, "en", uuid);
  const token = getAuthToken();
  let res: Response;
  try {
    res = await apiRawFetch(`/loans/${loanId}/statement`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...branchHeader() },
    });
  } catch (e) {
    // the server did not answer: the statement is made on this PC from its own copy of the loan and opened in the print dialog
    if (canMakeOffline(e)) return printOfflineLoanDocument("statement", loanId, "en", uuid);
    throw e;
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body (the PDF path) — fall back to statusText */
    }
    throw new ApiError(message, res.status);
  }

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : `statement-${loanId}.pdf`;

  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
}

/* Sends the pledge agreement straight to the print dialog (via
 * printPdfBlob), rendered server-side (GET /loans/:id/indemnity-bond/pdf)
 * — unlike the client-side print copy (modules/loans/utils/indemnityBond.ts's
 * printIndemnityBond, a plain window.print()), this one has a genuine
 * per-page header/footer: only Chrome's server-side PrintToPDF (chromedp,
 * in the backend) supports a real repeating header/footer template — a
 * browser's own "Save as PDF" from a live webpage has no equivalent a
 * page's own CSS can drive, only the browser's generic default (and only
 * if its own "Headers and footers" checkbox is on). Requires an
 * already-saved loan (numericId) — the NewLoan.tsx pre-submission preview
 * still uses the client-side copy, since there's no loan id yet to render
 * against. */
export async function downloadIndemnityBondPDF(loanNumericId: number, lang: BondLang, uuid?: string): Promise<void> {
  if (!loanNumericId && uuid && canRenderOffline()) return printOfflineLoanDocument("bond", 0, lang, uuid);
  try {
    return await downloadIndemnityBondOnline(loanNumericId, lang);
  } catch (e) {
    // the server did not answer: the pledge agreement is made on this PC from its bundled template and its copy of the loan
    if (canMakeOffline(e)) return printOfflineLoanDocument("bond", loanNumericId, lang, uuid);
    throw e;
  }
}

async function downloadIndemnityBondOnline(loanNumericId: number, lang: BondLang): Promise<void> {
  return printPdfJob(async () => {
    const token = getAuthToken();
    const res = await apiRawFetch(`/loans/${loanNumericId}/indemnity-bond/pdf?lang=${lang}`, {
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
  }, undefined, `pledge-agreement-${loanNumericId}.pdf`);
}

/* Gold Loan Pledge Slip — rendered server-side from
 * backend/templates/pledge-slip.html (GET /loans/:id/pledge-slip), sent
 * straight to the print dialog like the pledge agreement above. */
async function pledgeSlipResponse(loanNumericId: number, format?: "html"): Promise<Response> {
  const token = getAuthToken();
  const res = await apiRawFetch(`/loans/${loanNumericId}/pledge-slip${format ? `?format=${format}` : ""}`, {
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
  return res;
}

export async function downloadPledgeSlipPDF(loanNumericId: number, uuid?: string): Promise<void> {
  if (!loanNumericId && uuid && canRenderOffline()) return printOfflineLoanDocument("pledge-slip", 0, "en", uuid);
  try {
    return await printPdfJob(async () => (await pledgeSlipResponse(loanNumericId)).blob(), undefined, `pledge-slip-${loanNumericId}.pdf`);
  } catch (e) {
    if (canMakeOffline(e)) return printOfflineLoanDocument("pledge-slip", loanNumericId, "en", uuid);
    throw e;
  }
}

/* TML payment receipt (the TML "statement") — rendered server-side from
 * backend/templates/tml_statement.html for the loan's latest payment
 * (GET /loans/:id/statement-receipt) and sent straight to the print dialog. */
export async function downloadTmlStatementReceipt(loanNumericId: number, uuid?: string): Promise<void> {
  if (!loanNumericId && uuid && canRenderOffline()) return printOfflineLoanDocument("tml-statement", 0, "en", uuid);
  try {
    return await downloadTmlStatementReceiptOnline(loanNumericId);
  } catch (e) {
    if (canMakeOffline(e)) return printOfflineLoanDocument("tml-statement", loanNumericId, "en", uuid);
    throw e;
  }
}

async function downloadTmlStatementReceiptOnline(loanNumericId: number): Promise<void> {
  return printPdfJob(async () => {
    const token = getAuthToken();
    const res = await apiRawFetch(`/loans/${loanNumericId}/statement-receipt`, {
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
  }, undefined, `tml-receipt-${loanNumericId}.pdf`);
}

/* The same slip as an HTML document, for printing it together with the
 * packet label in one window (LoanDetail.tsx's printSlipAndLabel). Returns
 * the template's own <style> text and body markup. */
export async function fetchPledgeSlipParts(loanNumericId: number, uuid?: string): Promise<{ style: string; body: string }> {
  let text: string;
  if (!loanNumericId && uuid && canRenderOffline()) {
    text = await renderOfflineLoanDocument("pledge-slip", 0, "en", uuid);
  } else {
    try {
      text = await (await pledgeSlipResponse(loanNumericId, "html")).text();
    } catch (e) {
      if (!canMakeOffline(e)) throw e;
      text = await renderOfflineLoanDocument("pledge-slip", loanNumericId, "en", uuid);
    }
  }
  const doc = new DOMParser().parseFromString(text, "text/html");
  return {
    style: Array.from(doc.querySelectorAll("style")).map((s) => s.textContent || "").join("\n"),
    body: doc.body.innerHTML,
  };
}

/* Partial Ornament Release counterpart to downloadReleaseAgreementPDF below
 * — GET /loans/requests/:requestId/partial-release-receipt/pdf, keyed off
 * the request rather than the loan (the receipt lists only the ornaments
 * released BY THIS REQUEST). Only valid for a Release request with
 * isPartial true — see DownloadPartialReleaseReceiptPDF's own doc comment. */
export async function downloadPartialReleaseReceiptPDF(requestId: number, lang: "en" | "ml" = "en"): Promise<void> {
  try {
    return await downloadPartialReceiptOnline(requestId, lang);
  } catch (e) {
    if (!canMakeOffline(e)) throw e;
    // the server did not answer: made on this PC from the request and its copy of the loan
    const req = (await listLoanRequests().catch(() => [] as RequestView[])).find((r) => r.id === requestId);
    if (!req) throw e;
    return printOfflinePartialReceipt({ loanNumericId: req.loanNumericId, settlementAmount: req.settlementAmount, ornamentIds: req.ornamentIds }, lang);
  }
}

async function downloadPartialReceiptOnline(requestId: number, lang: "en" | "ml"): Promise<void> {
  return printPdfJob(async () => {
    const token = getAuthToken();
    const res = await apiRawFetch(`/loans/requests/${requestId}/partial-release-receipt/pdf?lang=${lang}`, {
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
  }, undefined, `partial-release-receipt-${requestId}.pdf`);
}

/* Sends the FORM 7 release/discharge agreement straight to the print dialog
 * (via printPdfBlob), rendered server-side (GET /loans/:id/release-agreement/pdf)
 * — the server-side replacement for the client-side print copy
 * (modules/loans/utils/releaseAgreement.ts's printReleaseAgreement, a plain
 * window.print()), with the same genuine per-page header/footer
 * downloadIndemnityBondPDF above gets. Requires an already-saved,
 * closed loan (loanNumericId) — every current caller (LoanDetail.tsx,
 * Requests.tsx) only reaches this once a loan is closed/release-approved, so
 * there is no pre-save preview variant, unlike the indemnity bond. */
export async function downloadReleaseAgreementPDF(loanNumericId: number, lang: "en" | "ml", uuid?: string): Promise<void> {
  if (!loanNumericId && uuid && canRenderOffline()) return printOfflineLoanDocument("release-agreement", 0, lang, uuid);
  try {
    return await downloadReleaseAgreementOnline(loanNumericId, lang);
  } catch (e) {
    if (canMakeOffline(e)) return printOfflineLoanDocument("release-agreement", loanNumericId, lang, uuid);
    throw e;
  }
}

async function downloadReleaseAgreementOnline(loanNumericId: number, lang: "en" | "ml"): Promise<void> {
  return printPdfJob(async () => {
    const token = getAuthToken();
    const res = await apiRawFetch(`/loans/${loanNumericId}/release-agreement/pdf?lang=${lang}`, {
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
  }, undefined, `release-agreement-${loanNumericId}.pdf`);
}

/* Pre-submission bond print (New Loan's "Pledge Agreement" button) — POST
 * /loans/indemnity-bond/preview-pdf, since there's no saved loan id yet to
 * GET a real one from. Renders the exact same server-side PDF (real
 * per-page header/footer included) downloadIndemnityBondPDF above gets for
 * an already-saved loan, and sends it straight to the print dialog the
 * same way via printPdfBlob — just POST with a JSON body instead of GET. */
export async function previewIndemnityBondPDF(data: IndemnityBondPreviewInput, lang: BondLang): Promise<void> {
  try {
    return await previewIndemnityBondOnline(data, lang);
  } catch (e) {
    if (canMakeOffline(e)) return printOfflineBondPreview(data, lang);
    throw e;
  }
}

async function previewIndemnityBondOnline(data: IndemnityBondPreviewInput, lang: BondLang): Promise<void> {
  return printPdfJob(async () => {
    const token = getAuthToken();
    const res = await apiRawFetch(`/loans/indemnity-bond/preview-pdf?lang=${lang}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...branchHeader(),
      },
      body: JSON.stringify(data),
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
  }, undefined, "pledge-agreement-preview.pdf");
}

/* Bank pledge edit / delete — rewrites the pledge's cash lines (and, once released, the release cash-out and the
 * "Bank Pledge Release" expense). Preview first with dryRun, then save. */
export type EditBankPledgeInput = {
  bankId?: number;
  bankName?: string;
  pledgedAmount?: number;
  pledgeDate?: string;
  bankPledgeDueDate?: string; // "" clears it
  bankInterestRate?: number;
  referenceNumber?: string;
  cashTreatment?: BankPledgeCashTreatment;
  cashAmount?: number;
  upiAmount?: number;
  bankTransferAmount?: number;
  receivedBankId?: number;
  // released pledges only
  releaseDate?: string;
  releaseCashAmount?: number;
  releaseUpiAmount?: number;
  releaseBankTransferAmount?: number;
  releaseBankId?: number;
};
export type BankPledgeEditPreview = { before: BackendBankPledgeRecord; after: BackendBankPledgeRecord | null; dryRun: boolean };

export async function editBankPledge(loanId: number, pledgeId: number, input: EditBankPledgeInput, dryRun = false): Promise<BankPledgeEditPreview> {
  if (!dryRun && canQueue()) return queueOnly("PATCH", `/loans/${loanId}/bank-pledge/${pledgeId}`, input, { dryRun: false } as unknown as BankPledgeEditPreview);
  return apiFetch<BankPledgeEditPreview>(`/loans/${loanId}/bank-pledge/${pledgeId}${dryRun ? "?dry_run=true" : ""}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteBankPledge(loanId: number, pledgeId: number, dryRun = false): Promise<BankPledgeEditPreview> {
  if (!dryRun && canQueue()) return queueOnly("DELETE", `/loans/${loanId}/bank-pledge/${pledgeId}`, undefined, { dryRun: false } as unknown as BankPledgeEditPreview);
  return apiFetch<BankPledgeEditPreview>(`/loans/${loanId}/bank-pledge/${pledgeId}${dryRun ? "?dry_run=true" : ""}`, { method: "DELETE" });
}

/* Gold-release request record: its date and notes. The money a release took is edited as ordinary loan payments. */
export async function editReleaseRecord(requestId: number, input: { requestedAt?: string; remarks?: string; verificationNotes?: string }): Promise<void> {
  if (canQueue()) {
    await queueOnly("PATCH", `/loans/requests/${requestId}/release-record`, input, undefined);
    return;
  }
  await apiFetch(`/loans/requests/${requestId}/release-record`, { method: "PATCH", body: JSON.stringify(input) });
}

export async function deleteReleaseRecord(requestId: number, current?: RequestView): Promise<void> {
  if (canQueue()) {
    // the server's own refusals, in its words, when the request is known here
    if (current?.status === "Approved") throw new ApiError("an approved release request cannot be deleted — the release was completed from it", 409);
    if (current && (current.paymentRecorded || current.locked || current.recordedPayment > 0)) {
      throw new ApiError("a payment was already recorded against this release request — delete or edit that payment in the ledger first", 409);
    }
    await queueOnly("DELETE", `/loans/requests/${requestId}/release-record`, undefined, undefined);
    return;
  }
  await apiFetch(`/loans/requests/${requestId}/release-record`, { method: "DELETE" });
}

/* Auction edit — the recorded sale, its surplus settlement and its write-off. Every call can be a dry run (nothing
 * saved); the answer lists the `dependents`: entries booked because of the sale (a settled surplus, a shortfall
 * decision, a write-off) that the change leaves stale. The ones the user ticks are sent back as applyDependents and
 * updated with it; a change that leaves a required one out is refused (409). */
export type AuctionDependent = {
  kind: "surplus_settlement" | "shortfall_decision" | "write_off";
  id: number;
  description: string;
  current: string;
  suggested: string;
  required: boolean;
};
export type AppliedAuctionDependent = { kind: AuctionDependent["kind"]; id: number };
export type AuctionSaleCurrent = {
  saleAmount: number; auctionExpenses: number; saleDate: string;
  cashAmount: number; upiAmount: number; bankTransferAmount: number; bankId?: number | null;
};
export type AuctionSaleOutcome = {
  saleAmount: number; auctionExpenses: number; netProceeds: number; totalDebt: number; appliedToLoan: number;
  surplusShortfall: number; surplus: number; shortfall: number; fullyCovered: boolean;
};
export type AuctionEditPreview = LedgerEditPreview & { dependents: AuctionDependent[]; current?: AuctionSaleCurrent; outcome?: AuctionSaleOutcome };
export type EditAuctionSaleInput = {
  saleAmount?: number; auctionExpenses?: number; saleDate?: string;
  cashAmount?: number; upiAmount?: number; bankTransferAmount?: number; bankId?: number;
  applyDependents?: AppliedAuctionDependent[];
};

const auctionQs = (dryRun: boolean) => (dryRun ? "?dry_run=true" : "");

/* The contract adapter only renames the keys it knows, so these calls spell their own: snake_case out, camelCase in. */
const toSnakeKeys = (v: unknown): unknown => Array.isArray(v) ? v.map(toSnakeKeys)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()), toSnakeKeys(x)])) : v;
const toCamelKeys = <T,>(v: unknown): T => (Array.isArray(v) ? v.map((x) => toCamelKeys(x))
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase()), toCamelKeys(x)]))
  : v) as T;
async function auctionCall<T>(path: string, method: "GET" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const res = await apiFetch<unknown>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(toSnakeKeys(body)) }) });
  return toCamelKeys<T>(res);
}

export async function getAuctionSaleCurrent(loanId: number): Promise<AuctionSaleCurrent> {
  return auctionCall<AuctionSaleCurrent>(`/loans/${loanId}/auction/sale`, "GET");
}
export async function editAuctionSale(loanId: number, input: EditAuctionSaleInput, dryRun = false): Promise<AuctionEditPreview> {
  if (!dryRun && canQueue()) return queueOnly("PATCH", `/loans/${loanId}/auction/sale`, toSnakeKeys(input), { dryRun: false } as unknown as AuctionEditPreview);
  return auctionCall<AuctionEditPreview>(`/loans/${loanId}/auction/sale${auctionQs(dryRun)}`, "PATCH", input);
}
export async function deleteAuctionSale(loanId: number, applyDependents: AppliedAuctionDependent[] = [], dryRun = false): Promise<AuctionEditPreview> {
  if (!dryRun && canQueue()) return queueOnly("DELETE", `/loans/${loanId}/auction/sale`, toSnakeKeys({ applyDependents }), { dryRun: false } as unknown as AuctionEditPreview);
  return auctionCall<AuctionEditPreview>(`/loans/${loanId}/auction/sale${auctionQs(dryRun)}`, "DELETE", { applyDependents });
}
export async function editAuctionSurplus(loanId: number, input: { disposition?: string; mode?: string; bankId?: number; settledOn?: string }, dryRun = false): Promise<AuctionEditPreview> {
  if (!dryRun && canQueue()) return queueOnly("PATCH", `/loans/${loanId}/auction/surplus`, toSnakeKeys(input), { dryRun: false } as unknown as AuctionEditPreview);
  return auctionCall<AuctionEditPreview>(`/loans/${loanId}/auction/surplus${auctionQs(dryRun)}`, "PATCH", input);
}
export async function deleteAuctionSurplus(loanId: number, dryRun = false): Promise<AuctionEditPreview> {
  if (!dryRun && canQueue()) return queueOnly("DELETE", `/loans/${loanId}/auction/surplus`, undefined, { dryRun: false } as unknown as AuctionEditPreview);
  return auctionCall<AuctionEditPreview>(`/loans/${loanId}/auction/surplus${auctionQs(dryRun)}`, "DELETE");
}
export async function editAuctionWriteOff(loanId: number, paidOn: string, dryRun = false): Promise<AuctionEditPreview> {
  if (!dryRun && canQueue()) return queueOnly("PATCH", `/loans/${loanId}/auction/write-off`, toSnakeKeys({ paidOn }), { dryRun: false } as unknown as AuctionEditPreview);
  return auctionCall<AuctionEditPreview>(`/loans/${loanId}/auction/write-off${auctionQs(dryRun)}`, "PATCH", { paidOn });
}
export async function deleteAuctionWriteOff(loanId: number, applyDependents: AppliedAuctionDependent[] = [], dryRun = false): Promise<AuctionEditPreview> {
  if (!dryRun && canQueue()) return queueOnly("DELETE", `/loans/${loanId}/auction/write-off`, toSnakeKeys({ applyDependents }), { dryRun: false } as unknown as AuctionEditPreview);
  return auctionCall<AuctionEditPreview>(`/loans/${loanId}/auction/write-off${auctionQs(dryRun)}`, "DELETE", { applyDependents });
}
