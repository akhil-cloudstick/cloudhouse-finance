import { apiFetchEnveloped as apiFetch, API_BASE, getAuthToken, ApiError } from "@/common/services/httpClient";
import { branchHeader } from "@/common/services/branchSelection";

/* Frontend service for backend/internal/reports (see handler.go/routes.go/
 * export.go). Every JSON list endpoint shares the same request/response
 * shape: common Filter query params in, {rows, totals, totalCount} out
 * (reports.Result) — so one generic fetch helper + one function per
 * endpoint is enough, rather than hand-rolling 16 near-identical bodies. */

export type ReportFilters = {
  from?: string; // "YYYY-MM-DD"
  to?: string; // "YYYY-MM-DD"
  branchId?: number;
  page?: number;
  pageSize?: number;
  // Per-report extra filters.
  status?: string; // /reports/loans/status
  triggerType?: string; // /reports/communication-history
};

export type ReportResult<Row, Totals> = {
  rows: Row[];
  totals: Totals;
  totalCount: number;
};

function buildQuery(filters: ReportFilters): string {
  const qs = new URLSearchParams();
  if (filters.from) qs.set("from", filters.from);
  if (filters.to) qs.set("to", filters.to);
  if (filters.branchId) qs.set("branch_id", String(filters.branchId));
  if (filters.page) qs.set("page", String(filters.page));
  if (filters.pageSize) qs.set("page_size", String(filters.pageSize));
  if (filters.status) qs.set("status", filters.status);
  if (filters.triggerType) qs.set("trigger_type", filters.triggerType);
  return qs.toString();
}

function fetchReport<Row, Totals>(path: string, filters: ReportFilters): Promise<ReportResult<Row, Totals>> {
  const qs = buildQuery(filters);
  return apiFetch<ReportResult<Row, Totals>>(`/reports/${path}${qs ? `?${qs}` : ""}`);
}

/* ---- Row/Totals shapes (mirror backend/internal/reports/model.go). ---- */

export type DisbursementRow = {
  loanId: number; loanNumber: string; openedDate: string; amount: number;
  branchName: string; customerName: string; schemeName: string;
};
export type DisbursementTotals = { count: number; totalAmount: number };

export type LoanStatusRow = {
  loanId: number; loanNumber: string; customerName: string; branchName: string;
  status: string; outstanding: number; dueDate: string;
};
export type LoanStatusTotals = {
  active: number; closed: number; dueSoon: number; overdue: number; defaulted: number; other: number; count: number;
};

export type InterestCollectionRow = {
  loanId: number; loanNumber: string; paidOn: string; interestApplied: number; penalApplied: number; branchName: string;
};
export type InterestCollectionTotals = { totalInterest: number; totalPenal: number; total: number };

export type OutstandingPrincipalRow = { branchName: string; loanCount: number; outstanding: number };
export type OutstandingPrincipalTotals = { totalOutstanding: number; totalLoans: number };

export type PaymentCollectionRow = {
  paymentId: number; loanNumber: string; paidOn: string; amount: number; type: string; branchName: string; employeeName: string;
};
export type PaymentCollectionTotals = { totalAmount: number; count: number };

export type GoldWeightRow = {
  ornamentId: number; loanNumber: string; customerName: string; name: string; purity: string;
  grossWeight: number; netWeight: number; goldValue: number;
};
export type GoldWeightTotals = { totalGrossWeight: number; totalNetWeight: number; totalGoldValue: number };

export type PacketRow = {
  packetId: number; code: string; loanNumber: string; status: string; lockerCode?: string | null; movementCount: number;
};
export type PacketTotals = { count: number; inLocker: number; bankPledged: number; released: number };

export type BankPledgeRow = {
  recordId: number; loanNumber: string; bankName: string; pledgedAmount: number;
  pledgeDate: string; releaseDate?: string | null; status: string;
};
export type BankPledgeTotals = { outstandingLiability: number; count: number };

export type LoanExtensionRow = {
  requestId: number; loanNumber: string; requestedAt: string; months?: number | null; newDueDate?: string | null; status: string;
};
export type LoanExtensionTotals = { count: number };

export type GoldReleaseRow = {
  requestId: number; loanNumber: string; customerName: string; requestedAt: string; settlementAmount: number; status: string;
};
export type GoldReleaseTotals = { count: number; totalSettlement: number };

export type AuctionRow = {
  recordId: number; loanNumber: string; stage: string; auctionDate?: string | null; saleAmount: number; settlementStatus: string;
};
export type AuctionTotals = { count: number; totalSaleAmount: number };

export type ExpenseCashflowRow = {
  date: string; branchName: string; collections: number; disbursements: number; cashExpenses: number;
};
export type ExpenseCashflowTotals = {
  totalCollections: number; totalDisbursements: number; totalExpenses: number; netCashflow: number;
};

export type KYCRow = {
  customerId: number; code: string; name: string; phone: string; kycStatus: string; panStatus: string; aadhaarStatus: string;
};
export type KYCTotals = { count: number; verified: number; pending: number };

export type GoldRateHistoryRow = { date: string; k24: number; setBy: string };
export type GoldRateHistoryTotals = { count: number };

export type EmployeePerformanceRow = {
  employeeId: number; name: string; role: string; branchName: string;
  loansProcessed: number; collectionsAmount: number; remindersSent: number; approvals: number;
};
export type EmployeePerformanceTotals = { totalLoansProcessed: number; totalCollections: number };

export type CommunicationHistoryRow = {
  id: number; recipientName: string; recipientPhone: string; channel: string; triggerType: string; status: string; sentAt: string;
};
export type CommunicationHistoryTotals = { count: number; sent: number; failed: number };

/* ---- Form G (Kerala Money-Lenders Rules 1964, Rule 15(3)) ----
 * Not a repeated-row report — a single fixed-layout statement — so it does
 * not use ReportResult<Row,Totals>/fetchReport like every report above; see
 * backend/internal/reports/formg.go for the full field-by-field rationale. */

export type FormGBranch = { name: string; address: string };

export type FormGLoanCategory = { label: string; persons: number; amount: number; remarks: string };

export type FormGDeposits = {
  openingCount: number; openingAmount: number;
  duringCount: number; duringAmount: number;
  repaidCount: number; repaidAmount: number;
  closingCount: number; closingAmount: number;
};

export type FormGFinancialPosition = {
  maxOutstanding: number;
  maxOutstandingDate?: string | null;
  assetsValue: number;
  liabilitiesValue: number;
  excessAssetsOverLiabilities: number;
  excessLiabilitiesOverAssets: number;
};

export type FormGStatement = {
  periodLabel: string;
  lenderName: string;
  lenderAddress: string;
  branches: FormGBranch[];
  section1Advanced: FormGLoanCategory[];
  section2Redeemed: FormGLoanCategory[];
  section3Deposits: FormGDeposits;
  section4FinancialPosition: FormGFinancialPosition;
};

/* Manual overrides for the figures this system has no ledger for (public
 * deposits, balance-sheet assets/liabilities) — sent ONLY on export, never
 * persisted; see backend/internal/reports/formg.go's FormGOverrides
 * doc comment for the full mechanism this mirrors. */
export type FormGOverrides = {
  depositOpeningCount?: number; depositOpeningAmount?: number;
  depositDuringCount?: number; depositDuringAmount?: number;
  depositRepaidCount?: number; depositRepaidAmount?: number;
  depositClosingCount?: number; depositClosingAmount?: number;
  assetsValue?: number;
  liabilitiesValue?: number;
};

export const getFormG = (f: ReportFilters): Promise<FormGStatement> => {
  const qs = buildQuery(f);
  return apiFetch<FormGStatement>(`/reports/form-g${qs ? `?${qs}` : ""}`);
};

function buildFormGOverridesQuery(o: FormGOverrides): URLSearchParams {
  const qs = new URLSearchParams();
  const set = (key: string, v?: number) => { if (v !== undefined && v !== null && v !== 0) qs.set(key, String(v)); };
  set("deposit_opening_count", o.depositOpeningCount);
  set("deposit_opening_amount", o.depositOpeningAmount);
  set("deposit_during_count", o.depositDuringCount);
  set("deposit_during_amount", o.depositDuringAmount);
  set("deposit_repaid_count", o.depositRepaidCount);
  set("deposit_repaid_amount", o.depositRepaidAmount);
  set("deposit_closing_count", o.depositClosingCount);
  set("deposit_closing_amount", o.depositClosingAmount);
  set("assets_value", o.assetsValue);
  set("liabilities_value", o.liabilitiesValue);
  return qs;
}

/* Downloads GET /reports/export/form-g?format=xlsx|pdf, folding the manual
 * overrides in as extra query params — mirrors exportReport below but
 * form-g needs the extra overrides on top of the shared filters. */
export async function exportFormG(format: "xlsx" | "pdf", filters: ReportFilters, overrides: FormGOverrides): Promise<void> {
  const { page: _page, pageSize: _pageSize, ...rest } = filters;
  const qs = buildQuery(rest);
  const params = new URLSearchParams(qs);
  params.set("format", format);
  const overrideParams = buildFormGOverridesQuery(overrides);
  overrideParams.forEach((v, k) => params.set(k, v));

  const token = getAuthToken();
  const res = await fetch(`${API_BASE}/reports/export/form-g?${params.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : `form-g.${format}`;

  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

/* ---- One function per report endpoint (path segments per routes.go). ---- */

export const getDisbursement = (f: ReportFilters) =>
  fetchReport<DisbursementRow, DisbursementTotals>("disbursement", f);

export const getLoansStatus = (f: ReportFilters) =>
  fetchReport<LoanStatusRow, LoanStatusTotals>("loans/status", f);

export const getInterestCollection = (f: ReportFilters) =>
  fetchReport<InterestCollectionRow, InterestCollectionTotals>("interest-collection", f);

export const getOutstandingPrincipal = (f: ReportFilters) =>
  fetchReport<OutstandingPrincipalRow, OutstandingPrincipalTotals>("outstanding-principal", f);

export const getPaymentCollection = (f: ReportFilters) =>
  fetchReport<PaymentCollectionRow, PaymentCollectionTotals>("payment-collection", f);

export const getGoldWeight = (f: ReportFilters) =>
  fetchReport<GoldWeightRow, GoldWeightTotals>("gold-weight", f);

export const getPackets = (f: ReportFilters) =>
  fetchReport<PacketRow, PacketTotals>("packets", f);

export const getBankPledge = (f: ReportFilters) =>
  fetchReport<BankPledgeRow, BankPledgeTotals>("bank-pledge", f);

export const getLoanExtensions = (f: ReportFilters) =>
  fetchReport<LoanExtensionRow, LoanExtensionTotals>("loan-extensions", f);

export const getGoldRelease = (f: ReportFilters) =>
  fetchReport<GoldReleaseRow, GoldReleaseTotals>("gold-release", f);

export const getAuctions = (f: ReportFilters) =>
  fetchReport<AuctionRow, AuctionTotals>("auctions", f);

export const getExpenseCashflow = (f: ReportFilters) =>
  fetchReport<ExpenseCashflowRow, ExpenseCashflowTotals>("expense-cashflow", f);

export const getKYC = (f: ReportFilters) =>
  fetchReport<KYCRow, KYCTotals>("kyc", f);

export const getGoldRateHistory = (f: ReportFilters) =>
  fetchReport<GoldRateHistoryRow, GoldRateHistoryTotals>("gold-rate-history", f);

export const getEmployeePerformance = (f: ReportFilters) =>
  fetchReport<EmployeePerformanceRow, EmployeePerformanceTotals>("employee-performance", f);

export const getCommunicationHistory = (f: ReportFilters) =>
  fetchReport<CommunicationHistoryRow, CommunicationHistoryTotals>("communication-history", f);

/* Report export keys, matching backend/internal/reports/export.go's
 * reportRows switch exactly (note "loans/status" list path vs
 * "loans-status" export key — the export key list is a *different* set of
 * strings from the list-endpoint path segments). */
export type ReportKey =
  | "disbursement" | "loans-status" | "interest-collection" | "outstanding-principal"
  | "payment-collection" | "gold-weight" | "packets" | "bank-pledge" | "loan-extensions"
  | "gold-release" | "auctions" | "expense-cashflow" | "kyc" | "gold-rate-history"
  | "employee-performance" | "communication-history" | "form-g";

/* Downloads GET /reports/export/:key?format=xlsx|pdf as a blob and triggers
 * a browser save, matching the object-URL + anchor-click pattern used for
 * other binary downloads in this app. Exports always fetch the full
 * (unpaginated) filtered result server-side, so page/pageSize are omitted
 * even if present on the passed-in filters. */
export async function exportReport(key: ReportKey, format: "xlsx" | "pdf", filters: ReportFilters): Promise<void> {
  const { page: _page, pageSize: _pageSize, ...rest } = filters;
  const qs = buildQuery(rest);
  const params = new URLSearchParams(qs);
  params.set("format", format);

  const token = getAuthToken();
  const res = await fetch(`${API_BASE}/reports/export/${key}?${params.toString()}`, {
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

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : `${key}.${format}`;

  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
