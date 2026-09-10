import { apiFetchEnveloped as apiFetch, apiUploadEnveloped as apiUpload, API_BASE, AUTH_TOKEN_KEY } from "@/common/services/httpClient";

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
export type CashMovementCategory = "" | "loan" | "auction" | "collection" | "expenses";

export type CashMovementFilters = { fromDate?: string; toDate?: string; category?: CashMovementCategory };

function movementFilterParams(filters?: CashMovementFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters?.fromDate) params.set("fromDate", filters.fromDate);
  if (filters?.toDate) params.set("toDate", filters.toDate);
  if (filters?.category) params.set("category", filters.category);
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
  const token = typeof window !== "undefined" ? window.localStorage.getItem(AUTH_TOKEN_KEY) : null;
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

/* Downloads every cash movement matching the given filters as a PDF —
 * respects fromDate/toDate/category exactly like the table above, but is
 * NEVER capped to a page size: the export always covers the full filtered
 * set, not just whatever's currently paginated into the browser. */
export async function exportCashMovements(filters?: CashMovementFilters): Promise<void> {
  const params = movementFilterParams(filters);
  const qs = params.toString() ? `?${params.toString()}` : "";
  await downloadFile(`/cash-movements/export${qs}`, "cash-movements.pdf");
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
  topUps: number;
};

export type CashOutBreakdown = {
  loanDisbursements: number;
  bankReleases: number;
  auctionRefunds: number;
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
