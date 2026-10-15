import { apiFetchEnveloped as apiFetch, apiRawFetch, getAuthToken, ApiError } from "@/common/services/httpClient";
import { branchHeader } from "@/common/services/branchSelection";
import { isSmallScreen } from "@/common/utils/responsive";
import { printPdfJob } from "@/common/utils/print";
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
    bankInterestRate: p.bankInterestRate,
    referenceNumber: p.referenceNumber,
    // Rows predating the cash-treatment field default to CashIn, which is what
    // they genuinely did — unconditional cash-in was the only behavior that
    // existed before. Defaulting to RecordOnly here would misreport history and
    // suppress the cash-out that releasing such a pledge needs.
    cashTreatment: p.cashTreatment || "CashIn",
    status: p.status || (p.releaseDate ? "Released" : "Active"),
    voidReason: p.voidReason || "",
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
  if (filters?.schemeId) params.set("schemeId", String(filters.schemeId));
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
  if (filters.schemeId) params.set("schemeId", String(filters.schemeId));
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
  opts?: { excludeBankPledged?: boolean }
): Promise<{ items: LoanView[]; hasMore: boolean }> {
  const params = new URLSearchParams({
    q,
    limit: String(LOAN_PAGE_SIZE),
    offset: String(page * LOAN_PAGE_SIZE),
  });
  if (opts?.excludeBankPledged) params.set("excludeBankPledged", "true");
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
  query?: string
): Promise<{ items: BankPledgeRecordView[]; hasMore: boolean; total: number }> {
  const pageSize = limit ?? (isSmallScreen() ? 7 : 10);
  const offset = (page - 1) * pageSize;
  const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
  if (query) params.set("q", query);
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
    surplusShortfall: r.surplusShortfall,
    surplusPayableAmount: r.surplusPayableAmount ?? 0,
    surplusDisposition: r.surplusDisposition || "",
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
      amountPaid: d.amountPaid,
      outstandingAtRequest: d.outstandingAtRequest,
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
  const base = { key: e.key, date: e.date, amount: e.amount, part: e.part, component: e.component, mode: e.mode, accruing: e.accruing };
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
  q?: string
): Promise<{ items: ConcludedAuctionRowView[]; hasMore: boolean; total: number }> {
  const pageSize = limit ?? (isSmallScreen() ? 7 : 10);
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
    hasSale: String(hasSale),
  });
  if (q && q.trim()) params.set("q", q.trim());
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
    amountPaid: d.amountPaid,
    outstandingAtRequest: d.outstandingAtRequest,
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
  if (filters?.loanId) params.set("loanId", String(filters.loanId));
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
  if (filters?.loanId) params.set("loanId", String(filters.loanId));
  if (filters?.type) params.set("type", filters.type);
  if (filters?.q) params.set("q", filters.q);
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
  filters?: { status?: string; riskLevel?: LoanRiskLevel; fromDate?: string; toDate?: string }
): Promise<{ items: LoanRiskRow[]; hasMore: boolean; total: number; counts: LoanRiskCounts }> {
  const pageSize = limit ?? LOAN_RISK_PAGE_SIZE;
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
  });
  if (filters?.status) params.set("status", filters.status);
  if (filters?.riskLevel) params.set("riskLevel", filters.riskLevel);
  if (filters?.fromDate) params.set("from", filters.fromDate);
  if (filters?.toDate) params.set("to", filters.toDate);
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
export async function createReleaseRequest(loanId: number, detail?: string, ornamentIds?: number[]): Promise<RequestView> {
  const rec = await apiFetch<BackendLoanRequest>(`/loans/${loanId}/release-request`, {
    method: "POST",
    body: JSON.stringify({ detail, ornamentIds: ornamentIds && ornamentIds.length ? ornamentIds : undefined }),
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
