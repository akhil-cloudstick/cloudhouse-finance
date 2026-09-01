import { apiRequestEnveloped as apiRequest } from "./client";
import { CashMovement, Expense, CashSummary } from "../types/cash";

// Cash movements — branch-scoped, no query params today.
export function listCashMovements() {
  return apiRequest<CashMovement[]>("/cash-movements");
}

// Page-scoped variant: passing `limit` flips the backend (cash/handler.go's
// MovementHandler.List) into the {items, hasMore} envelope — used by the
// paginated mobile Cash Movements table (10/page, one API call per page).
export function listCashMovementsPage(params: { limit: number; offset: number }) {
  return apiRequest<{ items: CashMovement[]; hasMore: boolean }>("/cash-movements", { params });
}

export function createCashMovement(input: {
  type: "in" | "out";
  source: string;
  purpose: string;
  bank?: string;
  amount: number;
  branchId?: number;
  occurredOn?: string;
}) {
  return apiRequest<CashMovement>("/cash-movements", { method: "POST", body: input });
}

export function setCashMovementStatus(id: number, status: string) {
  return apiRequest<CashMovement>(`/cash-movements/${id}/status`, { method: "PATCH", body: { status } });
}

// Expenses — same "no query params" note.
export function listExpenses() {
  return apiRequest<Expense[]>("/expenses");
}

// Page-scoped variant: passing `limit` flips the backend (cash/handler.go's
// ExpenseHandler.List) into the {items, hasMore} envelope — used by the
// paginated mobile Expenses table (10/page, one API call per page).
export function listExpensesPage(params: { limit: number; offset: number }) {
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
