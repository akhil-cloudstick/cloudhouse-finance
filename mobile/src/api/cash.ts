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
  // Optional now — the ledger row's text comes from the category.
  purpose?: string;
  // Payment mode ("Cash"/"UPI"/"Bank Transfer"/"Cheque") — movementRequest.Mode.
  mode?: string;
  bank?: string;
  // The branch's own account a UPI/Bank Transfer landed in — required for
  // those modes (see backend cash.MovementService.Record).
  bankId?: number;
  amount: number;
  branchId?: number;
  occurredOn?: string;
  loanSource?: LoanSourceInput;
  // Bill — an "/uploads/..." URL from the upload endpoint.
  receiptImage?: string;
}) {
  return apiRequest<CashMovement>("/cash-movements", { method: "POST", body: input });
}

// Bank-to-bank self transfer — the backend writes a debit row on the from
// bank and a credit row on the to bank. When `category` is a loan the backend
// forces the to bank to the loan's own bank, so toBankId isn't needed then.
export function createSelfTransfer(input: {
  category: string;
  amount: number;
  fromBankId: number;
  fromBank: string;
  toBankId?: number;
  toBank?: string;
  // How the money moved — shown on both rows.
  mode?: string;
  receiptImage?: string;
  branchId?: number;
  occurredOn: string;
}) {
  return apiRequest<CashMovement[]>("/cash-movements/self-transfer", { method: "POST", body: input });
}

// Cash sources — a small find-or-create lookup list (backend/internal/cash's
// CashSource) backing the Add Cash sheet's Source picker, real server-side
// pagination (matches web's cashSourceService.ts).
// type/isCommon: a search also returns categories of another form — picking
// one makes it common (find-or-create POST). A loan source carries its
// captured details (bankId/bank/principalAmount) once on file.
export type CategoryType = "cash_in" | "expense" | "self_transfer";
export type CashSource = {
  id: number;
  name: string;
  createdAt: string;
  type?: CategoryType;
  isCommon?: boolean;
  bankId?: number;
  bank?: { id: number; name: string };
  loanNumber?: string;
  principalAmount?: number;
};

export const CASH_SOURCES_PAGE_SIZE = 5;

// A dropdown picker passes a larger pageSize — at 5 its list has too few
// rows to scroll through (AsyncSelect shows up to 30).
export function listCashSourcesPage(q: string, page: number, pageSize: number = CASH_SOURCES_PAGE_SIZE) {
  return apiRequest<{ items: CashSource[]; hasMore: boolean }>("/cash-sources", {
    params: { q: q || undefined, limit: pageSize, offset: page * pageSize },
  });
}

export function createCashSource(name: string) {
  return apiRequest<CashSource>("/cash-sources", { method: "POST", body: { name } });
}

// Expense categories — same find-or-create/paginated pattern as cash
// sources, backing the Expense sheet's Category picker.
export type ExpenseCategory = { id: number; name: string; createdAt: string; type?: CategoryType; isCommon?: boolean; principalAmount?: number };

export const EXPENSE_CATEGORIES_PAGE_SIZE = 5;

export function listExpenseCategoriesPage(q: string, page: number, pageSize: number = EXPENSE_CATEGORIES_PAGE_SIZE) {
  return apiRequest<{ items: ExpenseCategory[]; hasMore: boolean }>("/expense-categories", {
    params: { q: q || undefined, limit: pageSize, offset: page * pageSize },
  });
}

// How many rows a mobile dropdown picker asks for (AsyncSelect's own cap).
export const PICKER_PAGE_SIZE = 30;

// Unified categories (GET /categories?type=) — the Self Transfer picker's
// list: its own plus every common one. Same shape as a cash source.
export type Category = CashSource;

export function listCategoriesPage(type: CategoryType, q: string, page: number, pageSize: number = PICKER_PAGE_SIZE) {
  return apiRequest<{ items: Category[]; hasMore: boolean }>("/categories", {
    params: { type, q: q || undefined, limit: pageSize, offset: page * pageSize },
  });
}

// Find-or-create: an existing name of another form comes back made common.
export function createCategory(type: CategoryType, name: string) {
  return apiRequest<Category>("/categories", { method: "POST", body: { name, type } });
}

export function createExpenseCategory(name: string) {
  return apiRequest<ExpenseCategory>("/expense-categories", { method: "POST", body: { name } });
}

export function setCashMovementStatus(id: number, status: string) {
  return apiRequest<CashMovement>(`/cash-movements/${id}/status`, { method: "PATCH", body: { status } });
}

// One row of any combined ledger (bank / customer / mode / expense category)
// — backend/internal/cash/ledger.go's LedgerRow, same shape the web
// PartyLedger.tsx/ModeLedgerPage.tsx render. runningBalance is computed
// server-side across the whole ledger, not just the loaded page.
export type LedgerRow = {
  id: number;
  date: string;
  description: string;
  type: string;
  method: string;
  reference: string;
  debitOrCredit: "debit" | "credit";
  amount: number;
  runningBalance: number;
  bankId?: number | null;
  bankName?: string;
  customerId?: number;
  customerName?: string;
  receiptImage?: string; // bill attached to the entry behind this row
};

export const LEDGER_MODES = ["Cash", "UPI", "Bank Transfer", "Cheque"] as const;
export type LedgerMode = (typeof LEDGER_MODES)[number];

export type LedgerKind = "bank" | "customer" | "category" | "mode";

type LedgerParams = { limit: number; offset: number; fromDate?: string; toDate?: string };
// totalDebit/totalCredit cover every row matching the filters, not the page.
type LedgerPage = { items: LedgerRow[]; total: number; totalDebit?: number; totalCredit?: number; categoryName?: string };

export function listCashMovementsByCustomer(customerId: number, params: LedgerParams) {
  return apiRequest<LedgerPage>(`/cash-movements/transactions/customer/${customerId}`, { params });
}

export function getBankLedger(bankId: number, params: LedgerParams) {
  return apiRequest<LedgerPage>(`/banks/${bankId}/ledger`, { params });
}

export function getModeLedger(mode: string, params: LedgerParams & { bankId?: number; branchIds?: string }) {
  return apiRequest<LedgerPage>("/cash-movements/mode-ledger", { params: { ...params, mode } });
}

export function getExpenseCategoryLedger(categoryId: number, params: LedgerParams) {
  return apiRequest<LedgerPage>(`/expense-categories/${categoryId}/ledger`, { params });
}

// One entry point for the shared ledger screen (app/(tabs)/cash/[id].tsx).
export function getLedger(kind: LedgerKind, ref: string, params: LedgerParams) {
  switch (kind) {
    case "bank":
      return getBankLedger(Number(ref), params);
    case "customer":
      return listCashMovementsByCustomer(Number(ref), params);
    case "category":
      return getExpenseCategoryLedger(Number(ref), params);
    case "mode":
      return getModeLedger(ref, params);
  }
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
  // Optional — the expense form no longer captures a description.
  payee?: string;
  branchId: number;
  // The branch account a UPI/Bank expense was paid from — required for
  // those modes (see backend cash.ExpenseService.Record).
  fromBankId?: number;
  remarks?: string;
  receiptImage?: string;
}) {
  return apiRequest<Expense>("/expenses", { method: "POST", body: input });
}

// Expense approval (tenant's "expense" flow — off by default, in which case
// expenses post immediately and never sit Pending). The server identifies
// the approver from the token and checks "can approve expense" (module
// Expense Approval), so no approver name is sent.
export function approveExpense(id: number) {
  return apiRequest<Expense>(`/expenses/${id}/approve`, { method: "PATCH", body: {} });
}

export function rejectExpense(id: number, remarks: string) {
  return apiRequest<Expense>(`/expenses/${id}/reject`, { method: "PATCH", body: { remarks } });
}

// Cash summary — branchId/date are real server-side params. Opening cash is
// carried forward from the previous day's closing Balance in Hand (backend
// cash.SummaryService.openingFor), so there's no opening balance to set.
export function getCashSummary(branchId: number, date?: string) {
  return apiRequest<CashSummary>("/cash/summary", { params: { branchId, date } });
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
  receiptImage?: string;
}) {
  return apiRequest<GoldSale>("/gold-sales", { method: "POST", body: input });
}

// A loan's position — principal, drawn (Add Cash) and repaid (expenses / self
// transfers) so far. GET /cash-sources/:id works for any category id.
export type LoanBalance = { principal: number; drawn: number; repaid: number; balance: number };

export async function getLoanBalance(id: number): Promise<LoanBalance | null> {
  const res = await apiRequest<{ isLoan: boolean; balance: LoanBalance }>(`/cash-sources/${id}`);
  return res.isLoan ? res.balance : null;
}

// Branch ledger — GET /cash-movements/transactions/branch/:id (web's
// listCashMovementsByBranch). Only the date range is applied server side;
// totals cover every row in that range.
export type BranchLedgerPage = {
  items: CashMovement[];
  total: number;
  totals: { totalIn: number; totalOut: number; net: number; inCount?: number; outCount?: number };
};

export function listCashMovementsByBranch(branchId: number, params: LedgerParams) {
  return apiRequest<BranchLedgerPage>(`/cash-movements/transactions/branch/${branchId}`, { params });
}
