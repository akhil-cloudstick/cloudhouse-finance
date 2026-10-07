import { apiFetchEnveloped as apiFetch } from "@/product/services/httpClient";
import type { BackendCashSource } from "./cashSourceService";
import { EXPENSE_CATEGORIES_CHANGED } from "./expenseCategoryService";

/* The unified category list (backend/internal/cash/model.go's Category) —
 * one table behind the Credit, Debit and Self Transfer pickers, told apart by
 * `type`. A category with isCommon is offered on every form. Same row shape
 * as a cash source (loan details included), so it reuses BackendCashSource. */
export type CategoryType = "cash_in" | "expense" | "self_transfer";
export type BackendCategory = BackendCashSource & { type: CategoryType; isCommon: boolean };

export const CATEGORIES_PAGE_SIZE = 5;

/* Page-shaped fetch for SearchableSelect's fetchFn contract
 * (GET /categories?type=&q=&limit=&offset=) — the categories shown on that
 * form: its own plus every common one. */
export function searchCategoriesPage(type: CategoryType) {
  return async (q: string, page: number): Promise<{ items: BackendCategory[]; hasMore: boolean }> => {
    const params = new URLSearchParams({ type, limit: String(CATEGORIES_PAGE_SIZE), offset: String(page * CATEGORIES_PAGE_SIZE) });
    if (q) params.set("q", q);
    const res = await apiFetch<{ items: BackendCategory[] | null; hasMore: boolean }>(`/categories?${params}`);
    return { items: res.items || [], hasMore: !!res.hasMore };
  };
}

/* Creates a category of `type`, or — when the name already exists (any
 * type) — returns that row, made common if it belonged to another form (the
 * backend's find-or-create rule). */
export function createCategory(type: CategoryType) {
  return async (name: string): Promise<BackendCategory> => {
    const rec = await apiFetch<BackendCategory>("/categories", {
      method: "POST",
      body: JSON.stringify({ name, type }),
    });
    if (typeof window !== "undefined") window.dispatchEvent(new Event(EXPENSE_CATEGORIES_CHANGED));
    return rec;
  };
}
