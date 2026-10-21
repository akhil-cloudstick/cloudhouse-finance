import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import { EXPENSE_CATEGORIES_CHANGED } from "./expenseCategoryService";
import type { CategoryType, BackendCategory } from "@/modules/cash/types/category-types";

export const CATEGORIES_PAGE_SIZE = 5;

export function searchCategoriesPage(type: CategoryType) {
  return async (q: string, page: number): Promise<{ items: BackendCategory[]; hasMore: boolean }> => {
    const params = new URLSearchParams({ type, limit: String(CATEGORIES_PAGE_SIZE), offset: String(page * CATEGORIES_PAGE_SIZE) });
    if (q) params.set("q", q);
    const res = await apiFetch<{ items: BackendCategory[] | null; hasMore: boolean }>(`/categories?${params}`);
    return { items: res.items || [], hasMore: !!res.hasMore };
  };
}

// Find-or-create: a name match from another form returns that row, made common.
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
