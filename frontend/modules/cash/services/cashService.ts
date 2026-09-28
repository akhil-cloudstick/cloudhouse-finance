import { apiFetchEnveloped as apiFetch, apiUploadEnveloped as apiUpload, API_BASE, getAuthToken } from "@/common/services/httpClient";

/* Shapes returned by the Go backend (backend/internal/cash/model.go). */
export type BackendCashMovement = {
  id: number;
  type: "in" | "out";
  source?: string;
  purpose?: string;
  // Mode of cash — "Cash" | "UPI" | "Bank Transfer" — required for type=in
  // via AddCashModal.tsx; blank for cash-out and every other movement that
  // doesn't record one (loan repayments, bank-pledge cash-in, …).
  mode?: string;
  bank?: string;
  amount: number;
  status?: string;
  branchId?: number | null;
  branch?: { id: number; name: string };
  occurredOn: string;
  createdAt: string;
  // Party Transactions ledger fields — see backend/internal/cash/model.go's
  // CashMovement. transactionGroupId groups several rows from one split
  // payment (see SplitPaymentInput.tsx); bankId/partyCustomerId are the
  // real, queryable identities behind the free-text bank/customer this
  // movement is tied to (nullable — not every movement has either).
  transactionGroupId?: string;
  bankId?: number | null;
  partyCustomerId?: number | null;
};

export type CashMovementView = {
  id: number;
  d: string;
  type: "in" | "out";
  source?: string;
  purpose?: string;
  mode?: string;
  bank?: string;
  amount: number;
  status?: string;
  branchId?: number | null;
  branchName?: string;
  transactionGroupId?: string;
  bankId?: number | null;
  partyCustomerId?: number | null;
};

function movementToView(m: BackendCashMovement): CashMovementView {
  return {
    id: m.id,
    d: m.occurredOn.slice(0, 10),
    type: m.type,
    source: m.source,
    purpose: m.purpose,
    mode: m.mode,
    bank: m.bank,
    amount: m.amount,
    status: m.status,
    branchId: m.branchId,
    branchName: m.branch?.name,
    transactionGroupId: m.transactionGroupId,
    bankId: m.bankId,
    partyCustomerId: m.partyCustomerId,
  };
}

export type CashMovementInput = {
  type: "in" | "out";
  source?: string;
  purpose?: string;
  mode?: string;
  bank?: string;
  amount: number;
  branchId?: number;
  occurredOn?: string; // "YYYY-MM-DD"
};

export async function listCashMovements(): Promise<CashMovementView[]> {
  const rec = await apiFetch<BackendCashMovement[]>("/cash-movements");
  return (rec || []).map(movementToView);
}

export const CASH_MOVEMENTS_PAGE_SIZE = 8;

// Mirrors backend/internal/cash/repository.go's Category* constants —
// "" (CategoryAll) applies no filter. Kept as a plain string union rather
// than an enum so a stray unrecognized value just falls through to "no
// filter" server-side instead of a client-side type error.
export type CashMovementCategory = "" | "loan" | "auction" | "collection" | "expenses" | "personal loan" | "investment";

export type CashMovementFilters = {
  fromDate?: string;
  toDate?: string;
  category?: CashMovementCategory;
  // branchIds/customerIds/types are the Ledger filter panel's multi-select
  // Branch/Customer/Type sections — separate from the single `category`
  // above (kept for existing single-select callers, e.g. Cash.tsx's legacy
  // state) since a Type section can now have several buckets checked at
  // once.
  branchIds?: string[];
  customerIds?: string[];
  types?: CashMovementCategory[];
};

function movementFilterParams(filters?: CashMovementFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters?.fromDate) params.set("fromDate", filters.fromDate);
  if (filters?.toDate) params.set("toDate", filters.toDate);
  if (filters?.category) params.set("category", filters.category);
  if (filters?.branchIds?.length) params.set("branchIds", filters.branchIds.join(","));
  if (filters?.customerIds?.length) params.set("customerIds", filters.customerIds.join(","));
  if (filters?.types?.length) params.set("types", filters.types.join(","));
  return params;
}

export async function listCashMovementsPage(
  page: number,
  limit?: number,
  filters?: CashMovementFilters
): Promise<{ items: CashMovementView[]; hasMore: boolean; total: number }> {
  const pageSize = limit ?? (typeof window !== "undefined" && (window.innerWidth < 1600 || window.innerHeight < 950) ? 7 : 8);
  const params = movementFilterParams(filters);
  params.set("limit", String(pageSize));
  params.set("offset", String((page - 1) * pageSize));
  const rec = await apiFetch<{ items: BackendCashMovement[]; hasMore: boolean; total?: number }>(`/cash-movements?${params}`);
  return { items: (rec?.items || []).map(movementToView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
}

/* Downloads a file from an endpoint that returns a raw file body (CSV),
 * not the {success, data} envelope apiFetchEnveloped expects — fetched by
 * hand with the same bearer token, then handed to the browser as a real
 * file save via a throwaway object-URL anchor click. */
async function downloadFile(path: string, fallbackFilename: string): Promise<void> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] || fallbackFilename;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* Downloads every cash movement matching the given filters as a PDF (the
 * default) or, with format: "xlsx", a spreadsheet — respects
 * fromDate/toDate/category/branchIds/customerIds/types exactly like the
 * table above, but is NEVER capped to a page size: the export always
 * covers the full filtered set, not just whatever's currently paginated
 * into the browser. */
export async function exportCashMovements(filters?: CashMovementFilters & { format?: "pdf" | "xlsx" }): Promise<void> {
  const params = movementFilterParams(filters);
  const format = filters?.format || "pdf";
  if (format === "xlsx") params.set("format", "xlsx");
  const qs = params.toString() ? `?${params.toString()}` : "";
  await downloadFile(`/cash-movements/export${qs}`, `cash-movements.${format}`);
}

/* Downloads every expense-register row (branch-scoped server-side, same as
 * the table) as a PDF. */
export async function exportExpenses(): Promise<void> {
  await downloadFile("/expenses/export", "expense-register.pdf");
}

export async function createCashMovement(input: CashMovementInput): Promise<CashMovementView> {
  const rec = await apiFetch<BackendCashMovement>("/cash-movements", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return movementToView(rec);
}

export async function setCashMovementLoanStatus(id: number, status: "Open" | "Closed"): Promise<CashMovementView> {
  const rec = await apiFetch<BackendCashMovement>(`/cash-movements/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  return movementToView(rec);
}

/* Expense register. */
export type BackendExpense = {
  id: number;
  occurredOn: string;
  category: string;
  amount: number;
  mode: string;
  payee: string;
  branchId: number;
  branch?: { id: number; name: string };
  status: "Pending" | "Approved" | "Rejected";
  remarks?: string;
  approvedBy?: string;
  approvedAt?: string;
  receiptImage?: string;
  createdAt: string;
};

export type ExpenseView = {
  id: number;
  d: string;
  cat: string;
  amt: number;
  mode: string;
  payee: string;
  branch: string;
  branchId: number;
  status: "Pending" | "Approved" | "Rejected";
  remarks?: string;
  img?: string;
};

function expenseToView(e: BackendExpense): ExpenseView {
  return {
    id: e.id,
    d: e.occurredOn.slice(0, 10),
    cat: e.category,
    amt: e.amount,
    mode: e.mode,
    payee: e.payee,
    branch: e.branch?.name || "",
    branchId: e.branchId,
    status: e.status,
    remarks: e.remarks,
    img: e.receiptImage,
  };
}

export type ExpenseFormInput = {
  category: string;
  amount: number;
  mode: string;
  payee: string;
  branchId: number;
  occurredOn?: string; // "YYYY-MM-DD"
  remarks?: string;
  receiptImage?: string; // /uploads/... URL, from uploadReceipt()
};

export async function listExpenses(): Promise<ExpenseView[]> {
  const rec = await apiFetch<BackendExpense[]>("/expenses");
  return (rec || []).map(expenseToView);
}

export const EXPENSES_PAGE_SIZE = 8;

export async function listExpensesPage(page: number, limit?: number): Promise<{ items: ExpenseView[]; hasMore: boolean; total: number }> {
  const pageSize = limit ?? (typeof window !== "undefined" && (window.innerWidth < 1600 || window.innerHeight < 950) ? 7 : 8);
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
  });
  const rec = await apiFetch<{ items: BackendExpense[]; hasMore: boolean; total?: number }>(`/expenses?${params}`);
  return { items: (rec?.items || []).map(expenseToView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
}

export async function createExpense(input: ExpenseFormInput): Promise<ExpenseView> {
  const rec = await apiFetch<BackendExpense>("/expenses", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return expenseToView(rec);
}

export async function approveExpense(id: number, approvedBy?: string): Promise<ExpenseView> {
  const rec = await apiFetch<BackendExpense>(`/expenses/${id}/approve`, {
    method: "PATCH",
    body: JSON.stringify({ approvedBy: approvedBy || "" }),
  });
  return expenseToView(rec);
}

export async function rejectExpense(id: number, remarks: string, approvedBy?: string): Promise<ExpenseView> {
  const rec = await apiFetch<BackendExpense>(`/expenses/${id}/reject`, {
    method: "PATCH",
    body: JSON.stringify({ remarks, approvedBy: approvedBy || "" }),
  });
  return expenseToView(rec);
}

/* Uploads a receipt/bill image via the shared upload endpoint and returns
 * the resulting URL, ready to pass as ExpenseFormInput.receiptImage. */
export async function uploadReceipt(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await apiUpload<{ url: string }>("/uploads", formData);
  return res.url;
}

/* Opening cash balance — one entry per branch per day. */
export type OpeningBalanceView = {
  branchId: number;
  balanceDate: string;
  amount: number;
  // False when nothing has been entered for that branch/day yet — `amount`
  // alone can't say, since an entered ₹0 and a missing entry both read as 0
  // (see cash.OpeningCashBalance.IsSet).
  isSet: boolean;
};

export async function getOpeningBalance(branchId: number, date?: string): Promise<OpeningBalanceView> {
  const qs = new URLSearchParams({ branchId: String(branchId) });
  if (date) qs.set("date", date);
  return apiFetch<OpeningBalanceView>(`/cash/opening-balance?${qs.toString()}`);
}

export async function setOpeningBalance(branchId: number, amount: number, date?: string): Promise<OpeningBalanceView> {
  return apiFetch<OpeningBalanceView>("/cash/opening-balance", {
    method: "POST",
    body: JSON.stringify({ branchId, amount, date }),
  });
}

/* Expected Cash in Hand summary — Opening + Collections - Disbursements - Cash Expenses. */
/* Mirrors cash.CashInBreakdown / cash.CashOutBreakdown — the per-source split
 * of the day's `collections` / `disbursements` totals (see
 * cash.MovementRepository.SumBreakdownByDate). */
export type CashInBreakdown = {
  repayments: number;
  pledges: number;
  auctions: number;
  goldSales: number;
  topUps: number;
};

export type CashOutBreakdown = {
  loanDisbursements: number;
  bankReleases: number;
  auctionRefunds: number;
  goldPurchases: number;
  withdrawals: number;
};

export type CashSummary = {
  openingCash: number;
  openingCashSet: boolean;
  collections: number;
  disbursements: number;
  cashExpenses: number;
  expensesToday: number;
  expectedCash: number;
  collectionsBreakdown: CashInBreakdown;
  disbursementsBreakdown: CashOutBreakdown;
};

export async function getCashSummary(branchId?: number, date?: string): Promise<CashSummary> {
  const qs = new URLSearchParams();
  if (branchId) qs.set("branchId", String(branchId));
  if (date) qs.set("date", date);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<CashSummary>(`/cash/summary${suffix}`);
}

/* Gold Sale — the business selling gold it owns (bought stock, NOT a
 * customer's pledged loan collateral — that's the Auction module instead).
 * Mirrors backend/internal/cash/model.go's GoldSale. Every sale also books a
 * matching cash-in movement (source "GoldSale"), so it's reflected in Cash-
 * in-Hand/Expected Cash automatically — no separate step needed here. */
export type BackendGoldSale = {
  id: number;
  ornamentType: string;
  soldAmount: number;
  costAmount: number;
  profit: number;
  soldOn: string;
  branchId: number;
  branch?: { id: number; name: string };
  cashMovementId?: number | null;
  costCashMovementId?: number | null;
  remarks?: string;
  createdAt: string;
};

export type GoldSaleView = {
  id: number;
  d: string;
  ornamentType: string;
  soldAmount: number;
  costAmount: number;
  profit: number;
  branch: string;
  branchId: number;
  remarks?: string;
};

function goldSaleToView(g: BackendGoldSale): GoldSaleView {
  return {
    id: g.id,
    d: g.soldOn.slice(0, 10),
    ornamentType: g.ornamentType,
    soldAmount: g.soldAmount,
    costAmount: g.costAmount,
    profit: g.profit,
    branch: g.branch?.name || "",
    branchId: g.branchId,
    remarks: g.remarks,
  };
}

export type GoldSaleInput = {
  ornamentType: string;
  soldAmount: number;
  costAmount: number;
  branchId: number;
  soldOn?: string; // "YYYY-MM-DD"
  remarks?: string;
};

export const GOLD_SALES_PAGE_SIZE = 8;

export async function listGoldSalesPage(
  page: number,
  limit?: number,
  filters?: { fromDate?: string; toDate?: string }
): Promise<{ items: GoldSaleView[]; hasMore: boolean; total: number }> {
  const pageSize = limit ?? GOLD_SALES_PAGE_SIZE;
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
  });
  if (filters?.fromDate) params.set("fromDate", filters.fromDate);
  if (filters?.toDate) params.set("toDate", filters.toDate);
  const rec = await apiFetch<{ items: BackendGoldSale[]; hasMore: boolean; total?: number }>(`/gold-sales?${params}`);
  return { items: (rec?.items || []).map(goldSaleToView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
}

export async function createGoldSale(input: GoldSaleInput): Promise<GoldSaleView> {
  const rec = await apiFetch<BackendGoldSale>("/gold-sales", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return goldSaleToView(rec);
}

/* Party Transactions ledger — one bank or customer's full cash-movement
 * history, drilled into from a Cash & Expenses row's bank/customer or from
 * CustomerDetail.tsx's own "Transactions" tab. Page size defaults to 12
 * (the Party Transactions page's own convention, distinct from the app's
 * usual 10) per backend/internal/cash/handler.go's partyPageSize. */
export const PARTY_PAGE_SIZE = 12;

export type PartyTotals = {
  totalIn: number;
  totalOut: number;
  net: number;
  inCount: number;
  outCount: number;
};

// loanNumbers is the customer drilldown's Loan filter, now multi-select —
// loanNumber (singular) is kept for any caller still passing exactly one.
export type PartyDateRange = { fromDate?: string; toDate?: string; loanNumber?: string; loanNumbers?: string[] };

function partyRangeParams(range?: PartyDateRange): URLSearchParams {
  const params = new URLSearchParams();
  if (range?.fromDate) params.set("fromDate", range.fromDate);
  if (range?.toDate) params.set("toDate", range.toDate);
  if (range?.loanNumber) params.set("loanNumber", range.loanNumber);
  if (range?.loanNumbers?.length) params.set("loanNumbers", range.loanNumbers.join(","));
  return params;
}

export async function listCashMovementsByBank(
  bankId: number,
  page: number,
  range?: PartyDateRange,
  pageSize: number = PARTY_PAGE_SIZE
): Promise<{ items: CashMovementView[]; total: number; totals: PartyTotals }> {
  const params = partyRangeParams(range);
  params.set("limit", String(pageSize));
  params.set("offset", String((page - 1) * pageSize));
  const rec = await apiFetch<{ items: BackendCashMovement[]; total: number; totals: PartyTotals }>(`/cash-movements/transactions/bank/${bankId}?${params}`);
  return { items: (rec?.items || []).map(movementToView), total: rec?.total ?? 0, totals: rec?.totals ?? { totalIn: 0, totalOut: 0, net: 0, inCount: 0, outCount: 0 } };
}

export async function listCashMovementsByCustomer(
  customerId: number,
  page: number,
  range?: PartyDateRange,
  pageSize: number = PARTY_PAGE_SIZE
): Promise<{ items: CashMovementView[]; total: number; totals: PartyTotals }> {
  const params = partyRangeParams(range);
  params.set("limit", String(pageSize));
  params.set("offset", String((page - 1) * pageSize));
  const rec = await apiFetch<{ items: BackendCashMovement[]; total: number; totals: PartyTotals }>(`/cash-movements/transactions/customer/${customerId}?${params}`);
  return { items: (rec?.items || []).map(movementToView), total: rec?.total ?? 0, totals: rec?.totals ?? { totalIn: 0, totalOut: 0, net: 0, inCount: 0, outCount: 0 } };
}

export async function exportPartyStatementByBank(bankId: number, range?: PartyDateRange): Promise<void> {
  const params = partyRangeParams(range);
  const qs = params.toString() ? `?${params.toString()}` : "";
  await downloadFile(`/cash-movements/transactions/bank/${bankId}/export${qs}`, "party-transactions.pdf");
}

export async function exportPartyStatementByCustomer(customerId: number, range?: PartyDateRange): Promise<void> {
  const params = partyRangeParams(range);
  const qs = params.toString() ? `?${params.toString()}` : "";
  await downloadFile(`/cash-movements/transactions/customer/${customerId}/export${qs}`, "party-transactions.pdf");
}

export async function listCashMovementsByBranch(
  branchId: number,
  page: number,
  range?: PartyDateRange,
  pageSize: number = PARTY_PAGE_SIZE
): Promise<{ items: CashMovementView[]; total: number; totals: PartyTotals }> {
  const params = partyRangeParams(range);
  params.set("limit", String(pageSize));
  params.set("offset", String((page - 1) * pageSize));
  const rec = await apiFetch<{ items: BackendCashMovement[]; total: number; totals: PartyTotals }>(`/cash-movements/transactions/branch/${branchId}?${params}`);
  return { items: (rec?.items || []).map(movementToView), total: rec?.total ?? 0, totals: rec?.totals ?? { totalIn: 0, totalOut: 0, net: 0, inCount: 0, outCount: 0 } };
}

export async function exportPartyStatementByBranch(branchId: number, range?: PartyDateRange): Promise<void> {
  const params = partyRangeParams(range);
  const qs = params.toString() ? `?${params.toString()}` : "";
  await downloadFile(`/cash-movements/transactions/branch/${branchId}/export${qs}`, "branch-ledger.pdf");
}
