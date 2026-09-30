import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import { ledgerRowToView, type BackendLedgerRow, type LedgerRowView } from "./cashService";

/* Shape returned by the Go backend (backend/internal/cash/model.go's
 * ExpenseCategory) — a small find-or-create lookup list backing
 * ExpenseModal.tsx's Category picker, replacing the hardcoded CATS array. */
export type BackendExpenseCategory = {
  id: number;
  name: string;
  createdAt: string;
};

export const EXPENSE_CATEGORIES_PAGE_SIZE = 5;

/* Page-shaped fetch for SearchableSelect's fetchFn contract — real
 * server-side pagination (GET /expense-categories?q=&limit=&offset=). */
export async function searchExpenseCategoriesPage(q: string, page: number): Promise<{ items: BackendExpenseCategory[]; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: String(EXPENSE_CATEGORIES_PAGE_SIZE), offset: String(page * EXPENSE_CATEGORIES_PAGE_SIZE) });
  if (q) params.set("q", q);
  const res = await apiFetch<{ items: BackendExpenseCategory[] | null; hasMore: boolean }>(`/expense-categories?${params}`);
  return { items: res.items || [], hasMore: !!res.hasMore };
}

/* Creates a new expense category, or — if one with the same name (case
 * insensitive) already exists — returns the existing row instead (the
 * backend's find-or-create behaviour). */
export async function createExpenseCategory(name: string): Promise<BackendExpenseCategory> {
  return apiFetch<BackendExpenseCategory>("/expense-categories", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export const EXPENSE_CATEGORY_LEDGER_PAGE_SIZE = 12;

/* Category ledger drill-down — every Expense recorded under this category,
 * as the same combined LedgerRow shape the bank/customer/loan ledgers use
 * (backend/internal/cash/ledger.go's ListLedgerByCategory). Matches by name
 * server-side (Expense.Category is still free text, no CategoryID FK yet —
 * see that function's own doc comment), so the id here is only used to
 * resolve which category, not as a join key on Expense itself. */
export async function getExpenseCategoryLedger(
  categoryId: number,
  page: number,
  range?: { fromDate?: string; toDate?: string },
  pageSize: number = EXPENSE_CATEGORY_LEDGER_PAGE_SIZE
): Promise<{ items: LedgerRowView[]; total: number; categoryName: string }> {
  const params = new URLSearchParams();
  if (range?.fromDate) params.set("fromDate", range.fromDate);
  if (range?.toDate) params.set("toDate", range.toDate);
  params.set("limit", String(pageSize));
  params.set("offset", String((page - 1) * pageSize));
  const rec = await apiFetch<{ items: BackendLedgerRow[]; total: number; categoryName: string }>(`/expense-categories/${categoryId}/ledger?${params}`);
  return { items: (rec?.items || []).map(ledgerRowToView), total: rec?.total ?? 0, categoryName: rec?.categoryName ?? "" };
}
