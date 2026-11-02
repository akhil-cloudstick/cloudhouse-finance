import { apiFetchEnveloped as apiFetch, apiRawFetch, getAuthToken, ApiError } from "@/common/services/httpClient";
import { branchHeader } from "@/common/services/branchSelection";
import { isSmallScreen } from "@/common/utils/responsive";
import { printPdfJob } from "@/common/utils/print";
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
    id: l.loanNumber,
    numericId: l.id,
    loanNumber: l.loanNumber,
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
export async function createLoan(input: CreateLoanInput): Promise<BackendLoan> {
  return apiFetch<BackendLoan>("/loans", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function saveDraft(input: SaveDraftInput): Promise<BackendLoanDraft> {
  return apiFetch<BackendLoanDraft>("/loans/drafts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/* Overwrites an existing draft — pressing "Save Draft" again in the same
 * sitting updates it in place rather than piling up near-duplicates. */
export async function updateDraft(draftId: number, input: SaveDraftInput): Promise<BackendLoanDraft> {
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
  await apiFetch<void>(`/loans/drafts/${draftId}`, { method: "DELETE" });
}

/* Attaches one photo to an already-created ornament. */
export async function addOrnamentImage(ornamentId: number, imageUrl: string): Promise<unknown> {
  return apiFetch(`/loans/ornaments/${ornamentId}/images`, {
    method: "POST",
    body: JSON.stringify({ imageUrl }),
  });
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

export async function listLoans(filters?: LoanFilters): Promise<LoanView[]> {
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
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String((filters.page - 1) * pageSize),
  });
  if (filters.q) params.set("q", filters.q);
  if (hasValue(filters.status)) params.set("status", csv(filters.status!));
  if (hasValue(filters.servicing)) params.set("servicing", csv(filters.servicing!));
  if (hasValue(filters.branchId)) params.set("branchId", csv(filters.branchId!));
  if (hasValue(filters.customerId)) params.set("customerId", csv(filters.customerId!));
  if (filters.bankPledgeStatus) params.set("bankPledgeStatus", filters.bankPledgeStatus);
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

export async function getLoan(id: number): Promise<LoanView> {
  const rec = await apiFetch<BackendLoan>(`/loans/${id}`);
  return toView(rec);
}

/* Direct, atomic lookup by loan number (backend/internal/loan's GET
 * /loans/by-number/:loanNumber) — used by LoanDetail.tsx instead of the
 * previous listLoans({q}) + client-side find + getLoan two-step, which
 * needed two round trips and could show a transient "Loan not found" if
 * the list call raced against another in-flight /loans request. */
export async function getLoanByNumber(loanNumber: string): Promise<LoanView> {
  const rec = await apiFetch<BackendLoan>(`/loans/by-number/${encodeURIComponent(loanNumber)}`);
  return toView(rec);
}

export async function addOrnament(loanId: number, input: OrnamentRequestInput): Promise<LoanView> {
  const rec = await apiFetch<BackendLoan>(`/loans/${loanId}/ornaments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toView(rec);
}

export async function updateOrnament(ornamentId: number, input: OrnamentRequestInput): Promise<LoanView> {
  const rec = await apiFetch<BackendLoan>(`/loans/ornaments/${ornamentId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return toView(rec);
}

/* Refused server-side if this is the loan's last remaining ornament, or if
 * the loan is already Closed/Auctioned — see backend Service.DeleteOrnament. */
export async function deleteOrnament(ornamentId: number): Promise<LoanView> {
  const rec = await apiFetch<BackendLoan>(`/loans/ornaments/${ornamentId}`, { method: "DELETE" });
  return toView(rec);
}

export async function recordPurityTest(ornamentId: number, input: PurityTestInput): Promise<BackendOrnament> {
  return apiFetch<BackendOrnament>(`/loans/ornaments/${ornamentId}/purity-test`, {
    method: "POST",
    body: JSON.stringify(input),
  });
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

export async function approveLoan(loanId: number, input: ApprovalInput): Promise<LoanView> {
  const rec = await apiFetch<BackendLoan>(`/loans/${loanId}/approve`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toView(rec);
}

/* What editing a loan that is already paid out would change — before and after, and the later payments that no longer
 * fit — without saving anything. */
export async function previewLoanEdit(loanId: number, input: UpdateLoanInput): Promise<LedgerPaymentEditPreview> {
  return apiFetch<LedgerPaymentEditPreview>(`/loans/${loanId}?dry_run=true`, { method: "PATCH", body: JSON.stringify(input) });
}

export async function updateLoan(loanId: number, input: UpdateLoanInput): Promise<LoanView> {
  const rec = await apiFetch<BackendLoan>(`/loans/${loanId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return toView(rec);
}

/* Permanently deletes a loan and every record tied to it — a real DELETE,
 * no undo. Gated server-side by its own "can hard delete loan" permission,
 * independent of the ordinary "can delete loan" grant — see backend
 * Service.HardDeleteLoan's own doc comment for the full cascade. */
export async function hardDeleteLoan(loanId: number): Promise<void> {
  await apiFetch<unknown>(`/loans/${loanId}/hard-delete`, { method: "DELETE" });
}

export async function recordPayment(loanId: number, input: PaymentInput): Promise<LoanView> {
  const rec = await apiFetch<BackendLoan>(`/loans/${loanId}/payments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toView(rec);
}

/* When the business has the loan_topup approval flow switched on, this
 * returns the loan UNCHANGED and parks a "Pending" top-up row in the chain
 * instead (see listTopUps/approveTopUp below) — nothing is paid out until its
 * final stage approves it. Only one pending top-up per loan (409 otherwise). */
export async function topUpLoan(loanId: number, input: TopUpInput): Promise<LoanView> {
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
  return apiFetch<LoanTopUpView>(`/loans/topups/${topUpId}/approve`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function recordBankPledge(loanId: number, input: BankPledgeInput): Promise<LoanView> {
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

export async function getBankPledgeHistory(loanId: number): Promise<BankPledgeRecordView[]> {
  const recs = await apiFetch<BackendBankPledgeRecord[] | null>(`/loans/${loanId}/bank-pledge/history`);
  return (recs || []).map(toBankPledgeRecordView);
}

export async function listBankPledgeHistory(): Promise<BankPledgeRecordView[]> {
  const recs = await apiFetch<BackendBankPledgeRecord[] | null>(`/loans/bank-pledges/history`);
  return (recs || []).map(toBankPledgeRecordView);
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
  return { items: (res.items || []).map(toBankPledgeRecordView), hasMore: res.hasMore, total: res.total ?? 0 };
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
  return l.isDefaulted || l.status === "Auction Eligible" || l.status === "Auctioned" || l.status === "Auctioned - Balance Due";
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

export async function markAuctionEligible(loanId: number): Promise<AuctionRecordView> {
  return toAuctionRecordView(await apiFetch<BackendAuctionRecord>(`/loans/${loanId}/auction/eligible`, { method: "POST" }));
}

// issueAuctionNotice always fires all three notice channels (SMS, WhatsApp,
// Registered Post) at once — the backend no longer takes a method, it logs
// one AuctionNotice per channel and sends the WhatsApp message live.
export async function issueAuctionNotice(loanId: number, remarks?: string): Promise<AuctionRecordView> {
  return toAuctionRecordView(
    await apiFetch<BackendAuctionRecord>(`/loans/${loanId}/auction/notice`, { method: "POST", body: JSON.stringify({ remarks }) })
  );
}

export async function scheduleAuction(loanId: number, auctionDate: string, referenceNumber?: string): Promise<AuctionRecordView> {
  return toAuctionRecordView(
    await apiFetch<BackendAuctionRecord>(`/loans/${loanId}/auction/schedule`, { method: "POST", body: JSON.stringify({ auctionDate, referenceNumber }) })
  );
}

export async function recordAuctionSale(loanId: number, saleAmount: number, auctionExpenses: number, payment?: { cashAmount: number; upiAmount: number; bankTransferAmount: number; bankId?: number }): Promise<AuctionRecordView> {
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

export async function getLoanLedger(loanId: number, q: LoanLedgerQuery): Promise<LoanLedgerPage> {
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
  stages?: string[]
): Promise<{ items: ConcludedAuctionRowView[]; hasMore: boolean; total: number }> {
  const pageSize = limit ?? (isSmallScreen() ? 7 : 10);
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
    hasSale: String(hasSale),
  });
  if (q && q.trim()) params.set("q", q.trim());
  if (stages && stages.length) params.set("stage", stages.join(","));
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
  };
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

export async function createExtensionRequest(loanId: number, months: number, detail?: string): Promise<RequestView> {
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
  const rec = await apiFetch<BackendLoanRequest>(`/loans/${loanId}/release-request`, {
    method: "POST",
    body: JSON.stringify({ detail, ornamentIds: ornamentIds && ornamentIds.length ? ornamentIds : undefined, requestedAt }),
  });
  return toRequestView(rec);
}

/* Extension-only decision — one step, mirrors DecideRequest on the backend.
 * Release requests use verifyReleaseChecklist + approveReleaseRequest
 * instead (the backend rejects a Release request here with
 * ErrNotExtensionRequest). */
// employeeId is NOT sent — the backend derives the deciding employee's
// identity from the authenticated JWT (see platform.ActorFromContext).
export async function decideRequest(requestId: number, action: "Approved" | "Rejected", remarks?: string): Promise<RequestView> {
  const rec = await apiFetch<BackendLoanRequest>(`/loans/requests/${requestId}/decide`, {
    method: "PUT",
    body: JSON.stringify({ action, remarks }),
  });
  return toRequestView(rec);
}

export async function verifyReleaseChecklist(requestId: number, input: ChecklistInput): Promise<RequestView> {
  const rec = await apiFetch<BackendLoanRequest>(`/loans/requests/${requestId}/verify`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return toRequestView(rec);
}

export async function recordReleasePayment(requestId: number, input: ReleasePaymentInput): Promise<RequestView> {
  const rec = await apiFetch<BackendLoanRequest>(`/loans/requests/${requestId}/release-payment`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toRequestView(rec);
}

export async function approveReleaseRequest(requestId: number, input: ReleaseApprovalInput): Promise<RequestView> {
  const rec = await apiFetch<BackendLoanRequest>(`/loans/requests/${requestId}/approve`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toRequestView(rec);
}

export async function approveExtensionRequest(requestId: number, input: ExtensionApprovalInput): Promise<RequestView> {
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
  return apiFetch<LedgerPaymentEditPreview>(`/loans/${loanId}/disbursement${dryRun ? "?dry_run=true" : ""}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteLoanTopUp(loanId: number, topUpId: number, dryRun = false, reason?: string, gold: LedgerGoldChoices = {}): Promise<LedgerPaymentEditPreview> {
  return apiFetch<LedgerPaymentEditPreview>(`/loans/${loanId}/top-ups/${topUpId}?${new URLSearchParams({ ...(reason ? { reason } : {}), ...(dryRun ? { dry_run: "true" } : {}), ...(gold.reversePacket ? { reverse_packet: "true" } : {}), ...(gold.restorePartialRelease ? { restore_partial_release: "true" } : {}) })}`, {
    method: "DELETE",
  });
}

export async function deleteLedgerPayment(loanId: number, paymentId: number, dryRun = false, reason?: string, gold: LedgerGoldChoices = {}): Promise<LedgerPaymentEditPreview> {
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
export async function downloadLoanStatement(loanId: number): Promise<void> {
  const token = getAuthToken();
  const res = await apiRawFetch(`/loans/${loanId}/statement`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...branchHeader() },
  });
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
export async function downloadIndemnityBondPDF(loanNumericId: number, lang: BondLang): Promise<void> {
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

export async function downloadPledgeSlipPDF(loanNumericId: number): Promise<void> {
  return printPdfJob(async () => (await pledgeSlipResponse(loanNumericId)).blob(), undefined, `pledge-slip-${loanNumericId}.pdf`);
}

/* TML payment receipt (the TML "statement") — rendered server-side from
 * backend/templates/tml_statement.html for the loan's latest payment
 * (GET /loans/:id/statement-receipt) and sent straight to the print dialog. */
export async function downloadTmlStatementReceipt(loanNumericId: number): Promise<void> {
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
export async function fetchPledgeSlipParts(loanNumericId: number): Promise<{ style: string; body: string }> {
  const text = await (await pledgeSlipResponse(loanNumericId, "html")).text();
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
export async function downloadReleaseAgreementPDF(loanNumericId: number, lang: "en" | "ml"): Promise<void> {
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
  return apiFetch<BankPledgeEditPreview>(`/loans/${loanId}/bank-pledge/${pledgeId}${dryRun ? "?dry_run=true" : ""}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteBankPledge(loanId: number, pledgeId: number, dryRun = false): Promise<BankPledgeEditPreview> {
  return apiFetch<BankPledgeEditPreview>(`/loans/${loanId}/bank-pledge/${pledgeId}${dryRun ? "?dry_run=true" : ""}`, { method: "DELETE" });
}

/* Gold-release request record: its date and notes. The money a release took is edited as ordinary loan payments. */
export async function editReleaseRecord(requestId: number, input: { requestedAt?: string; remarks?: string; verificationNotes?: string }): Promise<void> {
  await apiFetch(`/loans/requests/${requestId}/release-record`, { method: "PATCH", body: JSON.stringify(input) });
}

export async function deleteReleaseRecord(requestId: number): Promise<void> {
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
  return auctionCall<AuctionEditPreview>(`/loans/${loanId}/auction/sale${auctionQs(dryRun)}`, "PATCH", input);
}
export async function deleteAuctionSale(loanId: number, applyDependents: AppliedAuctionDependent[] = [], dryRun = false): Promise<AuctionEditPreview> {
  return auctionCall<AuctionEditPreview>(`/loans/${loanId}/auction/sale${auctionQs(dryRun)}`, "DELETE", { applyDependents });
}
export async function editAuctionSurplus(loanId: number, input: { disposition?: string; mode?: string; bankId?: number; settledOn?: string }, dryRun = false): Promise<AuctionEditPreview> {
  return auctionCall<AuctionEditPreview>(`/loans/${loanId}/auction/surplus${auctionQs(dryRun)}`, "PATCH", input);
}
export async function deleteAuctionSurplus(loanId: number, dryRun = false): Promise<AuctionEditPreview> {
  return auctionCall<AuctionEditPreview>(`/loans/${loanId}/auction/surplus${auctionQs(dryRun)}`, "DELETE");
}
export async function editAuctionWriteOff(loanId: number, paidOn: string, dryRun = false): Promise<AuctionEditPreview> {
  return auctionCall<AuctionEditPreview>(`/loans/${loanId}/auction/write-off${auctionQs(dryRun)}`, "PATCH", { paidOn });
}
export async function deleteAuctionWriteOff(loanId: number, applyDependents: AppliedAuctionDependent[] = [], dryRun = false): Promise<AuctionEditPreview> {
  return auctionCall<AuctionEditPreview>(`/loans/${loanId}/auction/write-off${auctionQs(dryRun)}`, "DELETE", { applyDependents });
}
