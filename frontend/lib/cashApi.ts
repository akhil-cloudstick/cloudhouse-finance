import { apiFetch, apiUpload } from "@/lib/api";

/* Shapes returned by the Go backend (backend/internal/cash/model.go). */
export type BackendCashMovement = {
  id: number;
  type: "in" | "out";
  source?: string;
  purpose?: string;
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
  bank?: string;
  amount: number;
  branchId?: number;
  occurredOn?: string; // "YYYY-MM-DD"
};

export async function listCashMovements(): Promise<CashMovementView[]> {
  const rec = await apiFetch<BackendCashMovement[]>("/cash-movements");
  return (rec || []).map(movementToView);
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
