import { apiRequestEnveloped as apiRequest } from "./client";
import { CashMovement, Expense, CashSummary, GoldSale } from "../types/cash";

// Cash movements — branch-scoped, no query params today.
export function listCashMovements() {
  return apiRequest<CashMovement[]>("/cash-movements");
}

// Page-scoped variant: passing `limit` flips the backend (cash/handler.go's
// MovementHandler.List) into the {items, hasMore} envelope — used by the
// paginated mobile Cash Movements table (10/page, one API call per page).
// `q` (purpose/source), fromDate/toDate and category are server-side
// filters; branchIds/customerIds/types are the multi-select Branch/
// Customer/Type filter (mirrors web's cashService.ts CashMovementFilters) —
// arrays are joined comma-separated since apiRequest's params only accept
// scalar values.
export function listCashMovementsPage(params: {
  limit: number;
  offset: number;
  q?: string;
  fromDate?: string;
  toDate?: string;
  category?: string;
  branchIds?: number[];
  customerIds?: number[];
  types?: string[];
}) {
  const { branchIds, customerIds, types, ...rest } = params;
  return apiRequest<{ items: CashMovement[]; hasMore: boolean; total?: number }>("/cash-movements", {
    params: {
      ...rest,
      branchIds: branchIds?.length ? branchIds.join(",") : undefined,
      customerIds: customerIds?.length ? customerIds.join(",") : undefined,
      types: types?.length ? types.join(",") : undefined,
    },
  });
}

// LoanSource mirrors backend/internal/cash/handler.go's loanSourceRequest —
// the Loan Details block MovementSheet captures when Source is "Loan"
// (bank/loanNumber/principalAmount required, interestRate/durationMonths
// optional). See backend/internal/cash/model.go's LoanCashSource.
export type LoanSourceInput = {
  bankId: number;
  loanNumber: string;
  principalAmount: number;
  interestRate?: number;
  durationMonths?: number;
};

export function createCashMovement(input: {
  type: "in" | "out";
  source: string;
  purpose: string;
  // Payment mode ("Cash"/"UPI"/"Bank Transfer"/"Cheque") — movementRequest.Mode.
  mode?: string;
  bank?: string;
  amount: number;
  branchId?: number;
  occurredOn?: string;
  loanSource?: LoanSourceInput;
}) {
  return apiRequest<CashMovement>("/cash-movements", { method: "POST", body: input });
}

// Cash sources — a small find-or-create lookup list (backend/internal/cash's
// CashSource) backing the Add Cash sheet's Source picker, real server-side
// pagination (matches web's cashSourceService.ts).
export type CashSource = { id: number; name: string; createdAt: string };

export const CASH_SOURCES_PAGE_SIZE = 5;

export function listCashSourcesPage(q: string, page: number) {
  return apiRequest<{ items: CashSource[]; hasMore: boolean }>("/cash-sources", {
    params: { q: q || undefined, limit: CASH_SOURCES_PAGE_SIZE, offset: page * CASH_SOURCES_PAGE_SIZE },
  });
}

export function createCashSource(name: string) {
  return apiRequest<CashSource>("/cash-sources", { method: "POST", body: { name } });
}

// Expense categories — same find-or-create/paginated pattern as cash
// sources, backing the Expense sheet's Category picker.
export type ExpenseCategory = { id: number; name: string; createdAt: string };

export const EXPENSE_CATEGORIES_PAGE_SIZE = 5;

export function listExpenseCategoriesPage(q: string, page: number) {
  return apiRequest<{ items: ExpenseCategory[]; hasMore: boolean }>("/expense-categories", {
    params: { q: q || undefined, limit: EXPENSE_CATEGORIES_PAGE_SIZE, offset: page * EXPENSE_CATEGORIES_PAGE_SIZE },
  });
}

export function createExpenseCategory(name: string) {
  return apiRequest<ExpenseCategory>("/expense-categories", { method: "POST", body: { name } });
}

export function setCashMovementStatus(id: number, status: string) {
  return apiRequest<CashMovement>(`/cash-movements/${id}/status`, { method: "PATCH", body: { status } });
}

// One customer's full cash-movement ledger — same backend endpoint the web
// Party Transactions page (PartyLedger.tsx) and CustomerDetail.tsx's Ledger
// tab both call (GET /cash-movements/transactions/customer/:id). `totals` is
// the party's overall in/out summary, not scoped to the current page.
export type PartyTotals = { totalIn: number; totalOut: number; net: number; inCount: number; outCount: number };

export function listCashMovementsByCustomer(customerId: number, params: { limit: number; offset: number; fromDate?: string; toDate?: string }) {
  return apiRequest<{ items: CashMovement[]; total: number; totals: PartyTotals }>(`/cash-movements/transactions/customer/${customerId}`, { params });
}

// Expenses — same "no query params" note.
export function listExpenses() {
  return apiRequest<Expense[]>("/expenses");
}

// Page-scoped variant: passing `limit` flips the backend (cash/handler.go's
// ExpenseHandler.List) into the {items, hasMore} envelope — used by the
// paginated mobile Expenses table (10/page, one API call per page).
export function listExpensesPage(params: { limit: number; offset: number; q?: string; status?: string }) {
  return apiRequest<{ items: Expense[]; hasMore: boolean }>("/expenses", { params });
}

export function createExpense(input: {
  occurredOn?: string;
  category: string;
  amount: number;
  mode: string;
  payee: string;
  branchId: number;
  remarks?: string;
  receiptImage?: string;
}) {
  return apiRequest<Expense>("/expenses", { method: "POST", body: input });
}

export function approveExpense(id: number, approvedBy?: string) {
  return apiRequest<Expense>(`/expenses/${id}/approve`, { method: "PATCH", body: { approvedBy } });
}

export function rejectExpense(id: number, remarks: string, approvedBy?: string) {
  return apiRequest<Expense>(`/expenses/${id}/reject`, { method: "PATCH", body: { approvedBy, remarks } });
}

// Cash summary / opening balance — branchId/date are real server-side
// params (see plan).
export function getCashSummary(branchId: number, date?: string) {
  return apiRequest<CashSummary>("/cash/summary", { params: { branchId, date } });
}

export function setOpeningBalance(branchId: number, amount: number, date?: string) {
  return apiRequest<void>("/cash/opening-balance", { method: "POST", body: { branchId, amount, date } });
}

// Gold sales — sold amount books a cash-in movement server-side (Source
// "GoldSale"), cost amount books a matching cash-out if > 0; see
// backend/internal/cash/handler.go's Record. Same {items,hasMore} pagination
// pattern as cash movements/expenses when `limit` is passed.
export function listGoldSalesPage(params: { limit: number; offset: number; q?: string; fromDate?: string; toDate?: string }) {
  return apiRequest<{ items: GoldSale[]; hasMore: boolean }>("/gold-sales", { params });
}

export function createGoldSale(input: {
  ornamentType: string;
  soldAmount: number;
  costAmount: number;
  branchId: number;
  // Mode is how the sale proceeds were received — "Cash" | "UPI" | "Bank
  // Transfer" (see backend GoldSale.Mode's doc comment). Omit for Cash.
  mode?: string;
  // bankId is required when mode is UPI or Bank Transfer.
  bankId?: number;
  soldOn?: string;
  remarks?: string;
}) {
  return apiRequest<GoldSale>("/gold-sales", { method: "POST", body: input });
}
