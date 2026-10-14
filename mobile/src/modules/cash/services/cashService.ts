import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import { CashMovement, Expense, CashSummary, GoldSale, type PaymentPart, type EntryInfo, type EntryUpdateInput, type LoanSourceInput, type CategoryType, type CashSource, type ExpenseCategory, type Category, type LedgerKind, type LedgerParams, type LedgerPage, type LoanBalance, type BranchLedgerPage } from "@/modules/cash/types/cash-types";

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
  modes?: string[];
}) {
  const { branchIds, customerIds, types, modes, ...rest } = params;
  // totalDebit/totalCredit cover every row matching the filters; pageBalance is the
  // ledger's running balance after this page's newest row (same as web's Ledger).
  return apiRequest<{ items: CashMovement[]; hasMore: boolean; total?: number; totalDebit?: number; totalCredit?: number; pageBalance?: number }>("/cash-movements", {
    params: {
      ...rest,
      branchIds: branchIds?.length ? branchIds.join(",") : undefined,
      customerIds: customerIds?.length ? customerIds.join(",") : undefined,
      types: types?.length ? types.join(",") : undefined,
      modes: modes?.length ? modes.join(",") : undefined,
    },
  });
}

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
  remarks?: string;
  // The payment breakdown — one ledger entry per line; must add up to amount.
  payments?: PaymentPart[];
}) {
  return apiRequest<CashMovement>("/cash-movements", { method: "POST", body: input });
}

// The info sheet's data for a cash-in, debit or self-transfer ledger row — `id`
// is the row's cash movement (CashMovement.id / LedgerRow.entryId).
export function getMovementEntry(id: number) {
  return apiRequest<EntryInfo>(`/cash-movements/${id}/entry`);
}

// The Expenses list's Edit form data for a pending or approved expense — `id` is the expense id.
export function getExpenseEntry(id: number) {
  return apiRequest<EntryInfo>(`/expenses/${id}/entry`);
}

// Saves an edit made in an entry form: from the Expenses list it goes to PUT /expenses/:id, from a
// ledger row to PUT /cash-movements/:id.
export function saveEntryEdit(info: EntryInfo, input: EntryUpdateInput) {
  return apiRequest<{ id: number }>(info.viaExpense ? `/expenses/${info.movementId}` : `/cash-movements/${info.movementId}`, { method: "PUT", body: input });
}

// Edits a cash-in, debit or self transfer from the ledger: the whole entry
// (every payment line, or both legs of a transfer) is replaced by the edited
// version. Needs no permission of its own.
export function updateMovementEntry(id: number, input: EntryUpdateInput) {
  return apiRequest<{ id: number }>(`/cash-movements/${id}`, { method: "PUT", body: input });
}

// Bank-to-bank self transfer — the backend writes a debit row on the from
// bank and a credit row on the to bank. When `category` is a loan there is no
// to bank: the backend books only the debit, as a repayment on that loan.
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
  remarks?: string;
}) {
  return apiRequest<CashMovement[]>("/cash-movements/self-transfer", { method: "POST", body: input });
}

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

export const EXPENSE_CATEGORIES_PAGE_SIZE = 5;

export function listExpenseCategoriesPage(q: string, page: number, pageSize: number = EXPENSE_CATEGORIES_PAGE_SIZE) {
  return apiRequest<{ items: ExpenseCategory[]; hasMore: boolean }>("/expense-categories", {
    params: { q: q || undefined, limit: pageSize, offset: page * pageSize },
  });
}

// How many rows a mobile dropdown picker asks for (AsyncSelect's own cap).
export const PICKER_PAGE_SIZE = 30;

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

export const LEDGER_MODES = ["Cash", "UPI", "Bank Transfer", "Cheque"] as const;

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
  return apiRequest<{ items: Expense[]; hasMore: boolean; total?: number; totalAmount?: number }>("/expenses", { params });
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
  // The payment breakdown — each line is saved as its own expense.
  payments?: PaymentPart[];
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
  return apiRequest<{ items: GoldSale[]; hasMore: boolean; total?: number; totalSold?: number; totalCost?: number; totalProfit?: number }>("/gold-sales", { params });
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

export async function getLoanBalance(id: number): Promise<LoanBalance | null> {
  const res = await apiRequest<{ isLoan: boolean; balance: LoanBalance }>(`/cash-sources/${id}`);
  return res.isLoan ? res.balance : null;
}

export function listCashMovementsByBranch(branchId: number, params: LedgerParams) {
  return apiRequest<BranchLedgerPage>(`/cash-movements/transactions/branch/${branchId}`, { params });
}
