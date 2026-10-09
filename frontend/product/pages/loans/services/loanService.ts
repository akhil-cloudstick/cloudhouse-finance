import { apiFetchEnveloped as apiFetch, API_BASE, getAuthToken, ApiError } from "@/product/services/httpClient";
import { branchHeader } from "@/product/services/branchSelection";
import { isSmallScreen } from "@/product/utils/responsive";
import { printPdfJob } from "@/product/utils/print";
import type { BondLang } from "@/product/pages/loans/utils/indemnityBond";

/* Mirrors backend/internal/loan/handler.go's ornamentRequest exactly. */
export type OrnamentRequestInput = {
  name: string;
  purity: string; // "24K" | "22K" | "18K"
  grossWeight: number;
  deductionWeight: number;
  quantity: number;
  remarks?: string;
};

/* Mirrors backend/internal/loan/handler.go's loanRequest exactly. */
export type CreateLoanInput = {
  branchId: number;
  customerId: number;
  schemeId: number;
  openedDate: string; // "YYYY-MM-DD"
  dueDate: string; // "YYYY-MM-DD"
  principalAmount: number;
  ornaments: OrnamentRequestInput[];
  // Optional — checks the auto-created tracking packet straight into this
  // locker at creation instead of leaving it ungrouped for a later manual
  // check-in (see backend/internal/packet/service.go's Create).
  lockerId?: number;
  // Optional — the saved draft this loan was submitted from, discarded
  // server-side once the loan exists (see the backend's loanRequest.DraftID).
  draftId?: number;
  // Optional free text captured at creation — anything the standard fields
  // don't cover, carried through onto the printed Statement of Account.
  additionalInfo?: string;
  // Per-loan choice of how the scheme's service charge is collected.
  serviceChargeMode?: "WithheldFromPayout" | "AddedToPrincipal";
};

/* Shape returned by the Go backend (backend/internal/loan/model.go's Loan —
 * returned directly, not through a separate response DTO). Only the
 * fields this module needs are typed here. */
export type BackendOrnamentImage = { id: number; ornamentId: number; imageUrl: string; createdAt: string };
export type BackendOrnamentPurityTest = {
  id: number;
  ornamentId: number;
  testedPurity: string;
  testedGrossWeight: number;
  testedDeductionWeight: number;
  testedNetWeight: number;
  testingRemarks: string;
  testedBy: string;
  testedAt: string;
};

export type BackendOrnament = {
  id: number;
  loanId: number;
  name: string;
  purity: string;
  grossWeight: number;
  deductionWeight: number;
  netWeight: number;
  quantity: number;
  goldValue: number;
  remarks: string;
  purityTest?: BackendOrnamentPurityTest | null;
  images?: BackendOrnamentImage[];
  releasedAt?: string | null;
};

export type BackendLoanApproval = {
  id: number;
  loanId: number;
  stage: string;
  action: string;
  actorEmployeeId: number;
  remarks: string;
  createdAt: string;
};

export type BackendLoanPayment = {
  id: number;
  loanId: number;
  amount: number;
  type: string;
  processingFee: number;
  processingFeeApplied: number;
  paidOn: string;
  receivedByEmployeeId: number;
  description: string;
  /* Derived/display-only — the single mode's name when exactly one split
   * amount below is non-zero, "Split" when more than one is. */
  method: string;
  cashAmount: number;
  upiAmount: number;
  bankTransferAmount: number;
  chequeAmount: number;
  reference: string;
  penalInterestApplied: number;
  interestApplied: number;
  principalApplied: number;
  runningBalance: number;
  /* Links this payment to the CashMovement row(s) it produced (one row per
   * non-zero mode among cashAmount/upiAmount/bankTransferAmount/
   * chequeAmount above, all sharing this group id) — empty for a payment
   * that never recorded cash (e.g. a Waiver) or whose cash-recording
   * failed. */
  cashTransactionGroupId?: string;
  bankId?: number | null;
  bankRef?: { id: number; name: string } | null;
  createdAt: string;
};

export type BackendBankPledgeRecord = {
  id: number;
  loanId: number;
  bankId: number | null;
  bankName: string;
  pledgedAmount: number;
  pledgeDate: string;
  releaseDate: string | null;
  bankPledgeDueDate: string | null;
  pledgedGrossWeight: number;
  pledgedNetWeight: number;
  bankInterestRate: number;
  referenceNumber: string;
  createdAt: string;

  /* Added with the cash-treatment toggle. Optional here because this same type
   * is used for pledges embedded in a loan response, where older serialized
   * payloads may not carry them — see toBankPledgeView for the defaults. */
  cashTreatment?: BankPledgeCashTreatment;
  status?: "Active" | "Released" | "Voided";
  voidedAt?: string | null;
  voidReason?: string;
  events?: {
    id: number;
    action: "Pledged" | "Released" | "Voided";
    actorRole?: string;
    amount: number;
    remarks?: string;
    createdAt: string;
  }[] | null;
};

/* Minimal shapes of the nested Branch/Customer/Scheme the backend preloads
 * onto every loan response — only the fields this module reads. */
type NestedBranch = { id: number; name: string; code: string };
type NestedCustomer = { id: number; name: string; code: string; phone: string };
type NestedScheme = { id: number; name: string; interestRate: number; ltvPercent: number; interestMethod: string; penalRate: number };

export type BackendLoan = {
  id: number;
  loanNumber: string;
  branchId: number;
  branch?: NestedBranch;
  customerId: number;
  customer?: NestedCustomer;
  schemeId: number;
  scheme?: NestedScheme;
  // The loan's own frozen scheme terms as they stood at creation (or the
  // last explicit scheme swap) — see backend Loan.SchemeInterestRate's doc
  // comment. Display must read these, not the live `scheme` above, so
  // editing a scheme later never changes what an existing loan shows it was
  // charged under.
  schemeInterestRate: number;
  schemeLtvPercent: number;
  schemeInterestMethod: string;
  schemePenalRate: number;
  openedDate: string;
  dueDate: string;
  additionalInfo?: string;
  totalNetWeight: number;
  totalGoldValue: number;
  eligibleLoanAmount: number;
  principalAmount: number;
  outstandingAmount: number;
  accruedInterest: number;
  interestPaid: number;
  accruedPenalInterest: number;
  penalInterestPaid: number;
  outstandingInterest: number;
  outstandingPenalInterest: number;
  outstandingProcessingFee: number;
  totalOutstandingBalance: number;
  settlementAmount: number;
  totalPaid: number;
  status: string;
  approvalStage: string;
  // Frozen at final sanction (Approve reaching FinalSanction), distinct from
  // principalAmount above which can still change pre-approval — see backend
  // Loan.SanctionedAmount's own doc comment. Zero/absent until the loan
  // actually clears final sanction.
  sanctionedAmount?: number;
  disbursedAmount?: number;
  serviceChargeMode?: string;
  serviceChargeAmount?: number;
  disbursementDate?: string | null;
  bankPledgeStatus: string;
  isDueSoon: boolean;
  isOverdue: boolean;
  isDefaulted: boolean;
  daysOverdue: number;
  auctionDate?: string | null;
  auctionAmount?: number | null;
  indemnityBondDocumentId?: string;
  indemnityBondSignRequestId?: string;
  indemnityBondSignStatus?: string;
  indemnityBondSignedUrl?: string;
  indemnityBondSignedAt?: string | null;
  ornaments?: BackendOrnament[];
  approvals?: BackendLoanApproval[];
  payments?: BackendLoanPayment[];
  bankPledges?: BackendBankPledgeRecord[];
  approvalWarning?: string;
  // Set only when the sanction chain rejected the loan (status "Rejected").
  rejectedByName?: string;
  rejectedAt?: string | null;
  rejectionRemarks?: string;
  createdAt: string;
  updatedAt: string;
};

/* UI-facing shape consumed by Loans.tsx / LoanDetail.tsx / LoanRow.tsx —
 * mirrors customersApi.ts's CustomerView convention: `id` is the string the
 * rest of the UI navigates/links with (here the human-readable loanNumber,
 * matching the old mock Loan.id shape of "GL-1001"-style strings so
 * #loan/<id> hash routing keeps working unchanged). */
export type OrnamentView = {
  id: number;
  name: string;
  purity: string;
  grossWeight: number;
  netWeight: number;
  quantity: number;
  goldValue: number;
  remarks: string;
  photoUrl?: string;
  // Set once CompleteRelease actually hands this ornament back — null while
  // still physically pledged. See backend/internal/loan/model_ornament.go's
  // Ornament.ReleasedAt doc comment.
  releasedAt: string | null;
};

export type PaymentView = {
  id: number;
  amount: number;
  type: string;
  processingFee: number;
  processingFeeApplied: number;
  paidOn: string; // "YYYY-MM-DD"
  receivedByEmployeeId: number;
  description: string;
  method: string;
  cashAmount: number;
  upiAmount: number;
  bankTransferAmount: number;
  chequeAmount: number;
  reference: string;
  penalInterestApplied: number;
  interestApplied: number;
  principalApplied: number;
  runningBalance: number;
  cashTransactionGroupId?: string;
  // Which bank the UPI/Bank Transfer/Cheque portion landed in — see
  // backend LoanPayment.BankID's doc comment. Nil for a Cash-only payment.
  bankId?: number | null;
  bankName?: string;
};

export type BankPledgeView = {
  id: number;
  bankId: number | null;
  bankName: string;
  pledgedAmount: number;
  pledgeDate: string;
  releaseDate: string | null;
  bankPledgeDueDate: string | null;
  pledgedGrossWeight: number;
  pledgedNetWeight: number;
  isReleased: boolean;
  bankInterestRate: number;
  referenceNumber: string;
  /* Whether this pledge put the bank's advance into Cash-in-Hand. Determines
   * whether releasing it books cash back out, so it is surfaced on the loan's
   * pledge rows, not just in the history view. */
  cashTreatment: BankPledgeCashTreatment;
  status: "Active" | "Released" | "Voided";
  voidReason: string;
};

export type LoanView = {
  id: string; // loanNumber
  numericId: number; // raw backend id, needed for mutation endpoints
  loanNumber: string;
  branchId: number;
  branchName: string;
  customerId: string; // stringified, matches CustomerView.id
  customerName: string;
  customerCode: string;
  schemeId: string; // stringified, matches SchemeView.id
  schemeName: string;
  schemeRate: number;
  schemeLtv: number;
  schemeMethod: string;
  schemePenal: number;
  opened: string; // "YYYY-MM-DD"
  due: string;
  additionalInfo: string;
  totalNetWeight: number;
  totalGoldValue: number;
  eligibleLoanAmount: number;
  principal: number;
  outstanding: number;
  accruedInterest: number;
  interestPaid: number;
  accruedPenalInterest: number;
  penalInterestPaid: number;
  outstandingInterest: number;
  outstandingPenalInterest: number;
  outstandingProcessingFee: number;
  totalOutstandingBalance: number;
  settlementAmount: number;
  totalPaid: number;
  status: string;
  approvalStage: string;
  sanctionedAmount: number;
  disbursedAmount: number;
  serviceChargeMode: string;
  serviceChargeAmount: number;
  disbursementDate: string | null;
  bankPledgeStatus: string;
  isDueSoon: boolean;
  isOverdue: boolean;
  isDefaulted: boolean;
  daysOverdue: number;
  approvalWarning: string;
  rejectedByName: string;
  rejectedAt: string | null;
  rejectionRemarks: string;
  auctionDate: string | null;
  auctionAmount: number | null;
  // Indemnity bond Aadhaar eSign (Setu) — indemnityBondSignStatus mirrors
  // Setu's own SignatureStatus.Status verbatim: "" (never started),
  // "sign_initiated", "sign_complete", or "failed". See
  // loansApi.ts's startIndemnityBondEsign/checkIndemnityBondEsign and
  // LoanDetail.tsx's "Send for Aadhaar eSign" action.
  indemnityBondSignStatus: string;
  indemnityBondSignedUrl: string;
  indemnityBondSignedAt: string | null;
  ornaments: OrnamentView[];
  payments: PaymentView[];
  bankPledges: BankPledgeView[];
};

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
    photoUrl: o.images && o.images.length ? o.images[o.images.length - 1].imageUrl : undefined,
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

/* --- Customer 360 sub-table rows -----------------------------------------
 * The 5 customer-scoped, server-paginated sub-tables (GET
 * /customers/:id/{loans,ornaments,payments,bank-pledges,auction-history} —
 * see backend/internal/loan/repository.go's CustomerOrnamentRow/
 * CustomerPaymentRow/CustomerBankPledgeRow/CustomerAuctionRow) span every
 * loan a customer has, so each row carries its parent loan's loanNumber
 * directly rather than requiring a second lookup against a separately
 * paginated Loan History table. */
export type BackendCustomerOrnamentRow = BackendOrnament & { loanNumber: string };
export type CustomerOrnamentRowView = OrnamentView & { loanId: number; loanNumber: string };
export function toCustomerOrnamentRowView(o: BackendCustomerOrnamentRow): CustomerOrnamentRowView {
  return { ...toOrnamentView(o), loanId: o.loanId, loanNumber: o.loanNumber };
}

export type BackendCustomerPaymentRow = BackendLoanPayment & { loanNumber: string };
export type CustomerPaymentRowView = PaymentView & { loanId: number; loanNumber: string };
export function toCustomerPaymentRowView(p: BackendCustomerPaymentRow): CustomerPaymentRowView {
  return { ...toPaymentView(p), loanId: p.loanId, loanNumber: p.loanNumber };
}

export type BackendCustomerBankPledgeRow = BackendBankPledgeRecord & { loanNumber: string };
export type CustomerBankPledgeRowView = BankPledgeView & { loanId: number; loanNumber: string };
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
    totalNetWeight: l.totalNetWeight,
    totalGoldValue: l.totalGoldValue,
    eligibleLoanAmount: l.eligibleLoanAmount,
    principal: l.principalAmount,
    outstanding: l.outstandingAmount,
    accruedInterest: l.accruedInterest,
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

/* --- Loan drafts ---------------------------------------------------------
 *
 * The "Save Draft" button on the New Gold Loan page (NewLoan.tsx), backed by
 * /loans/drafts (backend/internal/loan — see the LoanDraft model). A draft is
 * the form exactly as far as staff got: every field is optional, nothing is
 * validated, and no loan number/packet/gold rate is involved until it's
 * submitted through createLoan() in the normal way. Drafts are private to
 * the employee who saved them, enforced server-side from the JWT. */
export type DraftOrnamentInput = {
  name: string;
  purity: string;
  grossWeight: number;
  quantity: number;
  imageUrl?: string;
  imageName?: string;
};

export type SaveDraftInput = {
  branchId: number;
  customerId?: number;
  schemeId?: number;
  lockerId?: number;
  principalOverride?: number;
  ornaments: DraftOrnamentInput[];
};

export type BackendLoanDraft = {
  id: number;
  createdByEmployeeId: number;
  branchId: number;
  branch?: { id: number; name: string };
  customerId?: number;
  customer?: { id: number; name: string; code: string };
  schemeId?: number;
  scheme?: { id: number; name: string };
  lockerId?: number;
  principalOverride?: number;
  ornaments: {
    id: number;
    name: string;
    purity: string;
    grossWeight: number;
    quantity: number;
    imageUrl: string;
    imageName: string;
    position: number;
  }[];
  createdAt: string;
  updatedAt: string;
};

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

export type IndemnityBondEsignStart = {
  id: string;
  documentId: string;
  status: string;
  url: string;
};

/* Renders the loan's indemnity bond (in `lang`) server-side, uploads it to
 * Setu, and starts an Aadhaar eSign request — returns the signing URL the
 * CUSTOMER must open themselves (their own device/browser) to complete
 * Aadhaar+OTP signing. Mirrors customersApi.ts's startAadhaarVerify shape —
 * same "open URL, then poll" flow as DigiLocker Aadhaar verification. */
export type IndemnityBondDeliverBy = "open" | "whatsapp" | "dashboard";

export async function startIndemnityBondEsign(
  loanId: number,
  // BondLang, not a second inline union: the two drifted apart when
  // Gujarati was added, and the whole point of the shared type is that a
  // new language is one edit.
  lang: BondLang,
  redirectUrl: string,
  deliverBy: IndemnityBondDeliverBy = "open"
): Promise<IndemnityBondEsignStart> {
  return apiFetch<IndemnityBondEsignStart>(`/loans/${loanId}/indemnity-bond/esign/start`, {
    method: "POST",
    body: JSON.stringify({ lang, redirectUrl, deliverBy }),
  });
}

export type IndemnityBondEsignCheck = {
  loan: BackendLoan;
  status: string;
};

/* Polls the outstanding Setu signature request started by
 * startIndemnityBondEsign. Returns the current status while the customer
 * hasn't finished signing yet (poll again later), or the updated loan
 * (carrying indemnityBondSignedUrl) once "sign_complete". */
export async function checkIndemnityBondEsign(loanId: number): Promise<IndemnityBondEsignCheck> {
  return apiFetch<IndemnityBondEsignCheck>(`/loans/${loanId}/indemnity-bond/esign/status`);
}

export type ServicingClass = "due_soon" | "overdue" | "defaulted";

const csv = (v: string | number | (string | number)[]) => (Array.isArray(v) ? v.join(",") : String(v));
const hasValue = (v?: string | number | (string | number)[]) => (Array.isArray(v) ? v.length > 0 : !!v);

export type LoanFilters = {
  q?: string;
  status?: string | string[]; // an array matches any of the statuses
  // Read-time classes (not stored statuses): the Loans page's Due Soon / Overdue /
  // Defaulted tabs. A single one replaces `status` on the server; several are
  // OR-ed with each other and with `status`.
  servicing?: ServicingClass | ServicingClass[];
  branchId?: number | number[];
  customerId?: number | number[];
  bankPledgeStatus?: string;
  schemeId?: number;
  from?: string; // YYYY-MM-DD, bounds openedDate (inclusive)
  to?: string; // YYYY-MM-DD, bounds openedDate (inclusive)
};

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

export type PurityTestInput = {
  testedPurity: string;
  testedGrossWeight: number;
  testedDeductionWeight: number;
  testingRemarks?: string;
  testedBy: string;
  testedAt: string; // "YYYY-MM-DD"
};

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
export type SanctionStage = (typeof SANCTION_STAGES)[number];
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

export type ApprovalStageRecord = {
  id: number;
  loanId: number;
  stage: string;
  action: string;
  actorEmployeeId: number;
  actorRole: string;
  remarks: string;
  createdAt: string;
};

export async function listLoanApprovals(loanId: number): Promise<ApprovalStageRecord[]> {
  return (await apiFetch<ApprovalStageRecord[]>(`/loans/${loanId}/approvals`)) || [];
}

// employeeId/role are NOT sent — the backend derives the acting employee's
// identity and role from the authenticated JWT (see
// platform.ActorFromContext), never from the request body. Administrator's
// "may act at any pending stage" bypass still works, keyed off their real
// role.
// "Verified" is the LoanOperator stage's action — the operator verifies the
// loan they made, which advances the chain to the Branch Manager exactly
// like an "Approved" action does at the two stages above it. It is not
// valid at any other stage (backend: Service.Approve).
export type ApprovalInput = {
  stage: SanctionStage | string;
  action: "Approved" | "Rejected" | "Verified";
  remarks?: string;
  // Only meaningful (and only validated server-side) when this call is the
  // one that clears the FINAL enabled sanction stage (FinalSanction by
  // default, but whichever stage is last in this business's configured
  // chain) and triggers disbursement — must sum to the principal amount.
  cashAmount?: number;
  upiAmount?: number;
  bankTransferAmount?: number;
  chequeAmount?: number;
  // Which bank the UPI/Bank Transfer/Cheque portion was sent from —
  // mirrors PaymentInput.bankId. Only stored at FinalSanction disbursement.
  bankId?: number;
  // How the withheld service charge is recorded (same four-mode split as the
  // payout; must sum to the loan's service charge). Omitted = recorded as Cash.
  chargeCashAmount?: number;
  chargeUpiAmount?: number;
  chargeBankTransferAmount?: number;
  chargeChequeAmount?: number;
  chargeBankId?: number;
};

export async function approveLoan(loanId: number, input: ApprovalInput): Promise<LoanView> {
  const rec = await apiFetch<BackendLoan>(`/loans/${loanId}/approve`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toView(rec);
}

/* Editable even after final sanction (see backend Service.UpdateLoan's own
 * doc comment) — scheme and/or principal amount, either independently.
 * Ornaments themselves go through the existing addOrnament/updateOrnament/
 * deleteOrnament calls below, one ornament at a time, not through this. */
export type UpdateLoanInput = { schemeId?: number; principalAmount?: number };

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

// employeeId is NOT sent — the backend derives the receiving employee's
// identity from the authenticated JWT, never the request body (see
// platform.ActorFromContext).
export type PaymentInput = {
  amount: number;
  // What the amount may pay off. The API accepts only these five (see the
  // handler's staffSelectablePaymentTypes); Adjustment/Waiver and the auction
  // types are raised by their own flows, never posted from here.
  type: "Interest" | "Penal Interest" | "Principal" | "Partial" | "Full Settlement" | string;
  processingFee?: number; // extra charge collected alongside amount — never applied to penal/interest/principal
  paidOn: string;
  cashAmount?: number;
  upiAmount?: number;
  bankTransferAmount?: number;
  chequeAmount?: number;
  // Which bank the UPI/Bank Transfer/Cheque portion landed in — required
  // when any of those three is non-zero (see backend's
  // ErrBankRequiredForSplitMode).
  bankId?: number;
  reference?: string;
  description?: string;
  // Overrides the system-calculated interest bucket for this payment only
  // (see backend/internal/loan/service.go's PaymentInput.InterestOverride
  // doc comment) — omit to use the live-calculated figure, same as before
  // this existed.
  interestOverride?: number;
};

export async function recordPayment(loanId: number, input: PaymentInput): Promise<LoanView> {
  const rec = await apiFetch<BackendLoan>(`/loans/${loanId}/payments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toView(rec);
}

/* Top-up: draws additional cash against an already-Active loan's spare
 * eligible value (headroom = eligibleLoanAmount - outstanding), without
 * closing/reopening it — see backend/internal/loan/service.go's
 * Service.TopUpLoan. */
export type TopUpInput = {
  amount: number;
  cashAmount?: number;
  upiAmount?: number;
  bankTransferAmount?: number;
  chequeAmount?: number;
  occurredOn?: string; // "YYYY-MM-DD" — omit for today
  reference?: string;
  // "require" (default, if omitted) blocks the top-up when the loan has
  // outstanding interest/penal interest — staff must record that payment
  // separately first. "deduct" clears it out of this top-up's own cash
  // payout instead (the customer still draws the full requested amount
  // against the loan, but gets less cash out).
  settleInterest?: "require" | "deduct";
};

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

export type LoanTopUpView = {
  id: number;
  amount: number;
  eligibleAmountAtTopUp: number;
  cashAmount: number;
  upiAmount: number;
  bankTransferAmount: number;
  chequeAmount: number;
  occurredOn: string;
  reference: string;
  // Pending = waiting in the loan_topup approval chain (nothing paid out
  // yet); Rejected = turned down there. Only Active rows are real
  // disbursements.
  status: "Active" | "Reversed" | "Pending" | "Rejected";
  // The pending stage value while Pending ("PendingBranchManager", …),
  // "Approved"/"Rejected" once decided, "" when paid out with no chain.
  approvalStage: string;
  settleInterest: string;
  createdAt: string;
};

export async function listTopUps(loanId: number): Promise<LoanTopUpView[]> {
  return (await apiFetch<LoanTopUpView[]>(`/loans/${loanId}/topups`)) || [];
}

/* One decision on a pending top-up — stage is the stage KEY
 * ("BranchManager"/"Management"). The final enabled stage pays it out. The
 * acting employee/role come from the JWT. */
export type TopUpApprovalInput = { stage: string; action: "Approved" | "Rejected"; remarks?: string };

export async function approveTopUp(topUpId: number, input: TopUpApprovalInput): Promise<LoanTopUpView> {
  return apiFetch<LoanTopUpView>(`/loans/topups/${topUpId}/approve`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type BankPledgeInput = {
  bankId?: number;
  bankName: string;
  pledgedAmount: number;
  pledgeDate: string;
  bankInterestRate?: number;
  referenceNumber?: string;
  bankPledgeDueDate?: string;

  /* Whether the bank's advance actually entered the branch till ("CashIn") or
   * the pledge is pure book-keeping with no cash effect ("RecordOnly").
   * Omitting it means RecordOnly server-side — cash only moves when the
   * operator explicitly opts in. Immutable once saved: a wrong choice is
   * corrected by voiding the record (voidBankPledge) and re-creating it, never
   * by editing, since rewriting it would falsify booked cash history. */
  cashTreatment?: BankPledgeCashTreatment;

  /* How a "CashIn" advance was received, and the branch bank account a UPI/
   * Bank Transfer/Cheque share landed in. Omitted = all Cash. */
  cashAmount?: number;
  upiAmount?: number;
  bankTransferAmount?: number;
  chequeAmount?: number;
  receivedBankId?: number;
};

export type BankPledgeCashTreatment = "CashIn" | "RecordOnly";

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

/* --- Bank re-pledge history ---------------------------------------------
 * The Bank Re-Pledge page previously listed only currently-pledged loans, so a
 * released re-pledge vanished from the UI entirely. These endpoints expose the
 * full record set with its audit trail. */
export type BankPledgeEventView = {
  id: number;
  action: "Pledged" | "Released" | "Voided";
  actorRole: string;
  amount: number;
  remarks: string;
  createdAt: string;
};

export type BankPledgeRecordView = {
  id: number;
  loanId: number;
  // Populated only by rows that carry their parent loan alongside them
  // (the History tab's branch-wide query) — a plain per-loan history call
  // (GET /loans/:id/bank-pledge/history) already has the loan in context,
  // so its rows leave these blank rather than re-fetching what the caller
  // already has.
  loanNumber?: string;
  customerName?: string;
  bankName: string;
  pledgedAmount: number;
  pledgeDate: string;
  releaseDate: string | null;
  bankPledgeDueDate: string | null;
  bankInterestRate: number;
  referenceNumber: string;
  cashTreatment: BankPledgeCashTreatment;
  status: "Active" | "Released" | "Voided";
  voidedAt: string | null;
  voidReason: string;
  events: BankPledgeEventView[];
};

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
export type AuctionStage = (typeof AUCTION_STAGES)[number] | "Withdrawn";
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

export type AuctionSettlementStatus =
  | "Pending"
  | "SettledByRepayment"
  | "WrittenOff"
  | "SettledToCustomer"
  | "SettledToLoanCo";

/* Plain-English outcome labels for the History tab — the raw enum values say
 * little about what actually happened to the customer's gold. */
export const AUCTION_OUTCOME_LABELS: Record<AuctionSettlementStatus, string> = {
  Pending: "Awaiting settlement",
  SettledByRepayment: "Settled by repayment",
  WrittenOff: "Closed — written off",
  SettledToCustomer: "Settled — surplus refunded",
  SettledToLoanCo: "Settled — surplus retained",
};

export type AuctionSurplusDisposition = "RefundedToCustomer" | "RecordedAsIncome";

export type AuctionNoticeView = {
  id: number;
  issuedAt: string;
  method: string;
  remarks: string;
};

/* AuctionEventView is the staff-action audit trail. Notices already covered
 * customer communication; who scheduled, sold, or settled a case previously
 * left no trace at all. */
export type AuctionEventView = {
  id: number;
  action: string;
  actorRole: string;
  remarks: string;
  createdAt: string;
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

export type AuctionDecisionKind = "PartialRepayment" | "Shortfall";
export type AuctionDecisionStatus =
  | "Pending"
  | "KeepInAuction"
  | "RemovedFromAuction"
  | "WriteOff"
  | "PursueBalance";

/* AuctionDecisionRequestView is an escalation awaiting a human ruling. Raised
 * by the system, never by staff, so the decision cannot be quietly skipped:
 *  - PartialRepayment: customer part-paid; the auction is FROZEN until someone
 *    decides to keep or release the gold.
 *  - Shortfall: the sale did not cover the debt; only Branch Manager/
 *    Management/Administrator may write it off or pursue it. */
export type AuctionDecisionRequestView = {
  id: number;
  auctionRecordId: number;
  loanId: number;
  kind: AuctionDecisionKind;
  amountPaid: number;
  outstandingAtRequest: number;
  status: AuctionDecisionStatus;
  decidedByRole: string;
  decisionRemarks: string;
  createdAt: string;
  decidedAt: string | null;
};

export type AuctionRecordView = {
  id: number;
  loanId: number;
  stage: AuctionStage;
  auctionEligibleDate: string;
  auctionDate: string | null;
  auctionReferenceNumber: string;
  saleAmount: number;
  auctionExpenses: number;
  surplusShortfall: number;
  /* Money owed BACK to the customer when the gold fetched more than the debt.
   * Tracked explicitly because the full net proceeds are booked into the till,
   * so without this the customer's share would silently sit in branch cash. */
  surplusPayableAmount: number;
  surplusDisposition: AuctionSurplusDisposition | "";
  finalSettlementStatus: AuctionSettlementStatus;
  notices: AuctionNoticeView[];
  events: AuctionEventView[];
  decisionRequests: AuctionDecisionRequestView[];
};

/* Convenience accessors used by the Auctions UI to decide what to render. */
export function pendingDecision(rec: AuctionRecordView | null | undefined): AuctionDecisionRequestView | null {
  return rec?.decisionRequests.find((d) => d.status === "Pending") ?? null;
}
export function hasUndisposedSurplus(rec: AuctionRecordView): boolean {
  return rec.surplusPayableAmount > 0.01 && !rec.surplusDisposition;
}

type BackendAuctionEvent = {
  id: number;
  action: string;
  actorRole?: string;
  remarks?: string;
  createdAt: string;
};

type BackendAuctionDecisionRequest = {
  id: number;
  auctionRecordId: number;
  loanId: number;
  kind: AuctionDecisionKind;
  amountPaid: number;
  outstandingAtRequest: number;
  status: AuctionDecisionStatus;
  decidedByRole?: string;
  decisionRemarks?: string;
  createdAt: string;
  decidedAt?: string | null;
};

export type BackendAuctionRecord = {
  id: number;
  loanId: number;
  stage: AuctionStage;
  auctionEligibleDate: string;
  auctionDate: string | null;
  auctionReferenceNumber: string;
  saleAmount: number;
  auctionExpenses: number;
  surplusShortfall: number;
  surplusPayableAmount?: number;
  surplusDisposition?: AuctionSurplusDisposition | "";
  finalSettlementStatus: AuctionSettlementStatus;
  notices: { id: number; issuedAt: string; method: string; remarks: string }[] | null;
  events?: BackendAuctionEvent[] | null;
  decisionRequests?: BackendAuctionDecisionRequest[] | null;
};

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

export type BackendCustomerAuctionRow = BackendAuctionRecord & { loanNumber: string };
export type CustomerAuctionRowView = AuctionRecordView & { loanNumber: string };
export function toCustomerAuctionRowView(r: BackendCustomerAuctionRow): CustomerAuctionRowView {
  return { ...toAuctionRecordView(r), loanNumber: r.loanNumber };
}

/* The Auctions screen's History tab (Auctions.tsx's "Auctions Conducted" /
 * "Closed Without Auction" sub-tables) needs the loan number and customer
 * name to actually identify a row and link it — the same augmentation
 * CustomerAuctionRow already needed, mirrored here as its own type since
 * this one also carries CustomerName. */
export type BackendConcludedAuctionRow = BackendAuctionRecord & { loanNumber: string; customerName: string };
export type ConcludedAuctionRowView = AuctionRecordView & { loanNumber: string; customerName: string };
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

export async function recordAuctionSale(loanId: number, saleAmount: number, auctionExpenses: number): Promise<AuctionRecordView> {
  return toAuctionRecordView(
    await apiFetch<BackendAuctionRecord>(`/loans/${loanId}/auction/sale`, { method: "POST", body: JSON.stringify({ saleAmount, auctionExpenses }) })
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
): Promise<AuctionRecordView> {
  return toAuctionRecordView(
    await apiFetch<BackendAuctionRecord>(`/loans/${loanId}/auction/settle`, {
      method: "POST",
      body: JSON.stringify({ disposition, remarks }),
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

/* The Payment Ledger on LoanDetail — one page of the loan's whole history
 * (sanction, payments, top-ups, auction rows), built and paged by GET
 * /loans/:id/ledger (backend/internal/loan/ledger.go). Balances are carried
 * over the full history server-side, so any page shows the true figure. A
 * payment/payout/top-up split across modes is one row per mode — `part` is
 * that row's share. */
export type LoanLedgerPart = { mode: string; amount: number; index: number; count: number };
type LedgerEntryBase = { key: string; date: string; amount: number; part?: LoanLedgerPart };
export type LoanLedgerEntry =
  | (LedgerEntryBase & { kind: "sanction"; balance: number; payment: PaymentView | null })
  | (LedgerEntryBase & { kind: "payment"; balance: number; row: PaymentView; auction: AuctionRecordView | null })
  | (LedgerEntryBase & { kind: "topup"; balance: number; row: LoanTopUpView })
  | (LedgerEntryBase & { kind: "interest"; balance: number })
  | (LedgerEntryBase & { kind: "penal"; balance: number })
  | (LedgerEntryBase & { kind: "auction-sale"; balance: null; row: AuctionRecordView })
  | (LedgerEntryBase & { kind: "auction-surplus"; balance: null; row: AuctionRecordView });
// totalDebit/totalCredit sum the Debit/Credit columns over every row in the
// filtered range, not just this page — the footer's Total row.
export type LoanLedgerPage = { items: LoanLedgerEntry[]; total: number; limit: number; offset: number; totalDebit: number; totalCredit: number };
export type LoanLedgerQuery = {
  from?: string;
  to?: string;
  // Entry kinds to keep: sanction | payment | topup | interest | penal | auction.
  kinds?: string[];
  limit: number;
  offset: number;
  // Open on the page holding this row — by key, else by date + amount.
  focusKey?: string;
  focusDate?: string;
  focusAmount?: number;
};

type BackendLoanLedgerEntry = {
  kind: LoanLedgerEntry["kind"];
  key: string;
  date: string;
  amount: number;
  balance: number | null;
  part?: LoanLedgerPart;
  payment?: BackendLoanPayment;
  topUp?: LoanTopUpView;
  auction?: BackendAuctionRecord;
};

function toLedgerEntry(e: BackendLoanLedgerEntry): LoanLedgerEntry {
  const base = { key: e.key, date: e.date, amount: e.amount, part: e.part };
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

/* --- Extension & release requests ("Extensions & Release" page) ---------
 * Mirrors backend/internal/loan/model.go's LoanRequest. Staff log these on
 * a customer's behalf today (from LoanDetail.tsx / CustomerDetail.tsx); the
 * Android app can create the same records later via the same endpoints. */
export type BackendLoanRequest = {
  id: number;
  loanId: number;
  loan?: BackendLoan;
  type: LoanRequestType;
  status: "Pending" | "Approved" | "Rejected";
  requestedBy: "Customer" | "Staff";
  detail: string;
  requestedExtensionMonths?: number | null;
  newDueDate?: string | null;
  // Release only — the same Manager→Management chain used for loan
  // sanctioning (see backend/internal/loan/model.go's LoanRequest).
  approvalStage?: string;
  // isPartial/customerSawGold/paymentRecorded/locked are the reworked
  // Partial Ornament Release fields — see backend/internal/loan/
  // model_request.go's LoanRequest doc comment. paymentVerified/
  // packetVerified/bankPledgeVerified/customerConfirmed are the RETIRED
  // 4-item checklist, kept only because the backend still serialises them
  // (nothing writes/reads them any more) — not used by this file any more.
  isPartial: boolean;
  customerSawGold: boolean;
  paymentRecorded: boolean;
  locked: boolean;
  paymentVerified: boolean;
  packetVerified: boolean;
  bankPledgeVerified: boolean;
  customerConfirmed: boolean;
  verificationNotes: string;
  charges: number;
  // How much of `charges` has already been posted onto the loan as a real
  // payment (see backend/internal/loan/service.go's RecordReleasePayment) —
  // `charges - chargesApplied` is what's still left to collect.
  chargesApplied: number;
  settlementAmount: number;
  // "Record Payment" step on the Manager-stage release review screen — see
  // backend/internal/loan/service.go's RecordReleasePayment.
  recordedDiscount: number;
  recordedPayment: number;
  paymentDueDate?: string | null;
  // Partial Ornament Release's selected-ornament set — see
  // backend/internal/loan/model_request.go's LoanRequestOrnament.
  ornamentSelections?: { id: number; requestId: number; ornamentId: number }[];
  remarks: string;
  requestedAt: string;
  decidedAt?: string | null;
  decidedByEmployeeId?: number | null;
  createdAt: string;
};

export type LoanRequestType = "Extension" | "Release";

export type RequestView = {
  id: number;
  loanId: string; // loanNumber, matches LoanView.id
  loanNumericId: number; // raw backend loan id, needed to fetch full loan financials
  loanNumber: string;
  customerName: string;
  type: LoanRequestType;
  status: "Pending" | "Approved" | "Rejected";
  detail: string;
  requestedAt: string; // "YYYY-MM-DD"
  remarks: string;
  requestedExtensionMonths: number | null;
  approvalStage: string; // "" for Extension requests
  isPartial: boolean;
  customerSawGold: boolean;
  paymentRecorded: boolean;
  locked: boolean;
  verificationNotes: string;
  charges: number;
  chargesApplied: number;
  settlementAmount: number;
  recordedDiscount: number;
  recordedPayment: number;
  paymentDueDate: string | null; // "YYYY-MM-DD", null if not set
  // Ornament IDs selected for release on this request — empty for a plain
  // full release (or an Extension request).
  ornamentIds: number[];
};

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

export type LoanRequestFilters = {
  status?: string;
  loanId?: number;
  /* "extension" | "release" — server-side, matches LoanRequest.Type. */
  type?: string;
  /* Server-side search: loan number, customer name / code / phone. */
  q?: string;
};

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

/* Gold-value risk assessment — mirrors backend/internal/loan/service.go's
 * LoanRiskRow exactly. Compares each open loan's principal against what its
 * pledged gold would fetch sold TODAY (today's published rate × each
 * ornament's own purity/weight — a loan can carry mixed-purity ornaments),
 * not the value the loan was opened at. */
export type LoanRiskLevel = "Safe" | "AtRisk" | "Loss";

export type LoanRiskRow = {
  loanId: number;
  loanNumber: string;
  customerId: number;
  customerName: string;
  status: string;
  principalAmount: number;
  outstandingAmount: number;
  totalNetWeight: number;
  currentGoldValue: number;
  riskLevel: LoanRiskLevel;
};

// RISK_STATUSES mirrors backend/internal/loan/service.go's
// riskEligibleStatuses exactly — the loan statuses where gold is still in
// custody and a real principal is still owed against it. Backs the risk
// page's own status filter dropdown.
export const RISK_STATUSES = ["Active", "Due Soon", "Overdue", "Closure Requested", "Defaulted", "Auction Eligible"] as const;

export const LOAN_RISK_PAGE_SIZE = 15;

// Mirrors backend/internal/loan/handler.go's ListRiskAssessment response
// envelope — counts/total cover every loan matching status/date (NOT the
// riskLevel filter below), not just the current page, so the KPI tiles stay
// a true breakdown of the whole matching set even while one risk level is
// selected.
export type LoanRiskCounts = { loss: number; atRisk: number; safe: number };

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

/* --- Release verification checklist & approval chain --------------------
 * Reworked 2-item checklist (customerSawGold + the payment step below) —
 * see backend/internal/loan/model_request.go's LoanRequest doc comment and
 * VerifyReleaseChecklist's handler, which reads customerSawGold as a
 * "present or not" *bool so it can tell "explicitly set to false" apart
 * from "field omitted"; leaving it undefined here therefore leaves the
 * server-side value untouched, same as charges/verificationNotes below. */
export type ChecklistInput = {
  customerSawGold?: boolean;
  verificationNotes?: string;
  charges?: number;
};

export async function verifyReleaseChecklist(requestId: number, input: ChecklistInput): Promise<RequestView> {
  const rec = await apiFetch<BackendLoanRequest>(`/loans/requests/${requestId}/verify`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return toRequestView(rec);
}

/* "Record Payment" step on the release review screen — now driven by the
 * SAME general payment shape PaymentModalContent posts to /loans/:id/payments
 * (see PaymentInput above), plus a Discount amount posted alongside it as a
 * real PaymentTypeDiscount ledger entry (see backend/internal/loan/
 * service.go's RecordReleaseRequestPayment). On success this flips
 * PaymentRecorded/Locked true and auto-advances the request through the
 * Manager stage — there is no more separate "does this clear the balance"
 * branch on the frontend, the backend handles the whole waterfall. */
export type ReleasePaymentInput = {
  type?: string;
  amount: number;
  discount?: number;
  cashAmount?: number;
  upiAmount?: number;
  bankTransferAmount?: number;
  chequeAmount?: number;
  bankId?: number;
  method?: string;
  reference?: string;
  interestOverride?: number;
  dueDate?: string;
};

export async function recordReleasePayment(requestId: number, input: ReleasePaymentInput): Promise<RequestView> {
  const rec = await apiFetch<BackendLoanRequest>(`/loans/requests/${requestId}/release-payment`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toRequestView(rec);
}

// employeeId is NOT sent — see platform.ActorFromContext's doc comment.
// stage is the release flow's stage KEY ("Manager"/"Management") — which of
// them apply is per-business configuration (flow "loan_release").
export type ReleaseApprovalInput = { stage: string; action: "Approved" | "Rejected"; remarks?: string };

export async function approveReleaseRequest(requestId: number, input: ReleaseApprovalInput): Promise<RequestView> {
  const rec = await apiFetch<BackendLoanRequest>(`/loans/requests/${requestId}/approve`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toRequestView(rec);
}

/* --- Extension approval chain --------------------------------------------
 * Loan Officer -> Branch Manager -> Management, the same generalized
 * POST /loans/requests/:requestId/approve endpoint as Release (the backend
 * dispatches by the request's own Type — see
 * backend/internal/loan/service.go's ApproveExtensionRequest). Unlike
 * Release, this stage IS server-side role-gated (ActorRole is checked
 * against each stage's required role, Administrator bypasses); employeeId/
 * role are still not sent from here — the backend derives both from the
 * JWT (platform.ActorFromContext). */
// stage is the extension flow's stage KEY ("LoanOfficer"/"BranchManager"/
// "Management") — which of them apply is per-business configuration (flow
// "loan_extension").
export type ExtensionApprovalInput = { stage: string; action: "Approved" | "Rejected"; remarks?: string };

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
  const res = await fetch(`${API_BASE}/loans/${loanId}/statement`, {
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
  window.URL.revokeObjectURL(url);
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
    const res = await fetch(`${API_BASE}/loans/${loanNumericId}/indemnity-bond/pdf?lang=${lang}`, {
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
  });
}

/* Gold Loan Pledge Slip — rendered server-side from
 * backend/templates/pledge-slip.html (GET /loans/:id/pledge-slip), sent
 * straight to the print dialog like the pledge agreement above. */
async function pledgeSlipResponse(loanNumericId: number, format?: "html"): Promise<Response> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}/loans/${loanNumericId}/pledge-slip${format ? `?format=${format}` : ""}`, {
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
  return printPdfJob(async () => (await pledgeSlipResponse(loanNumericId)).blob());
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
    const res = await fetch(`${API_BASE}/loans/requests/${requestId}/partial-release-receipt/pdf?lang=${lang}`, {
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
  });
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
    const res = await fetch(`${API_BASE}/loans/${loanNumericId}/release-agreement/pdf?lang=${lang}`, {
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
  });
}

/* Same shape NewLoan.tsx's buildDraft() already assembles for the old
 * client-side printIndemnityBond() call — ornaments included. */
export type IndemnityBondPreviewInput = {
  loanNumber: string;
  name?: string;
  dob?: string;
  address?: string;
  branchName?: string;
  phone?: string;
  pan?: string;
  aadhaar?: string;
  principalAmount?: number;
  interestRate?: number;
  dueDate?: string;
  ornaments: { name: string; purity?: string; grossWeight: number; netWeight: number; value: number }[];
};

/* Pre-submission bond print (New Loan's "Pledge Agreement" button) — POST
 * /loans/indemnity-bond/preview-pdf, since there's no saved loan id yet to
 * GET a real one from. Renders the exact same server-side PDF (real
 * per-page header/footer included) downloadIndemnityBondPDF above gets for
 * an already-saved loan, and sends it straight to the print dialog the
 * same way via printPdfBlob — just POST with a JSON body instead of GET. */
export async function previewIndemnityBondPDF(data: IndemnityBondPreviewInput, lang: BondLang): Promise<void> {
  return printPdfJob(async () => {
    const token = getAuthToken();
    const res = await fetch(`${API_BASE}/loans/indemnity-bond/preview-pdf?lang=${lang}`, {
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
  });
}
