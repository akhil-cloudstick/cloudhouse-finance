import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import { ledgerRowToView } from "./cashService";
import { type BackendLedgerRow, type LedgerRowView } from "@/modules/cash/types/cash-types";
import type { BackendExpenseCategory, LoanLedgerSummary } from "@/modules/cash/types/expense-category-types";

export const EXPENSE_CATEGORIES_PAGE_SIZE = 5;

export async function searchExpenseCategoriesPage(q: string, page: number): Promise<{ items: BackendExpenseCategory[]; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: String(EXPENSE_CATEGORIES_PAGE_SIZE), offset: String(page * EXPENSE_CATEGORIES_PAGE_SIZE) });
  if (q) params.set("q", q);
  const res = await apiFetch<{ items: BackendExpenseCategory[] | null; hasMore: boolean }>(`/expense-categories?${params}`);
  return { items: res.items || [], hasMore: !!res.hasMore };
}

// Fired by createExpenseCategory so every mounted useExpenseCategoryIds reloads.
export const EXPENSE_CATEGORIES_CHANGED = "expense-categories-changed";

function notifyExpenseCategoriesChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EXPENSE_CATEGORIES_CHANGED));
}

export async function createExpenseCategory(name: string): Promise<BackendExpenseCategory> {
  const rec = await apiFetch<BackendExpenseCategory>("/expense-categories", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  notifyExpenseCategoriesChanged();
  return rec;
}

export const EXPENSE_CATEGORY_LEDGER_PAGE_SIZE = 12;

// Function declaration so it is hoisted for cashService, which this file also imports from.
export function categoryLedgerPath(categoryId: number | string): string {
  return `/expense-categories/${categoryId}/ledger`;
}

// Matches by name server-side (Expense.Category is still free text, no CategoryID FK yet).
export async function getExpenseCategoryLedger(
  categoryId: number,
  page: number,
  range?: { fromDate?: string; toDate?: string; focusDate?: string; focusAmount?: number },
  pageSize: number = EXPENSE_CATEGORY_LEDGER_PAGE_SIZE
): Promise<{ items: LedgerRowView[]; total: number; totalDebit: number; totalCredit: number; categoryName: string; loan?: LoanLedgerSummary; focusPage?: number }> {
  const params = new URLSearchParams();
  if (range?.fromDate) params.set("fromDate", range.fromDate);
  if (range?.toDate) params.set("toDate", range.toDate);
  if (range?.focusAmount != null) {
    params.set("focusAmount", String(range.focusAmount));
    if (range.focusDate) params.set("focusDate", range.focusDate);
  }
  params.set("limit", String(pageSize));
  params.set("offset", String((page - 1) * pageSize));
  const rec = await apiFetch<{ items: BackendLedgerRow[]; total: number; totalDebit?: number; totalCredit?: number; categoryName: string; loan?: LoanLedgerSummary; focusPage?: number }>(`${categoryLedgerPath(categoryId)}?${params}`);
  return { items: (rec?.items || []).map(ledgerRowToView), total: rec?.total ?? 0, totalDebit: rec?.totalDebit ?? 0, totalCredit: rec?.totalCredit ?? 0, categoryName: rec?.categoryName ?? "", loan: rec?.loan, focusPage: rec?.focusPage };
}
