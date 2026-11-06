import { checkCategoryName } from "./cashOfflineChecks";
import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import { enqueueAndWait, listLocal, newEntry, offlineReady, removeLocal, upsertLocal, type LocalRecord } from "@/common/offline";
import { currentActor } from "@/common/offline/actor";
import { EXPENSE_CATEGORIES_CHANGED } from "./expenseCategoryService";
import type { CategoryType, BackendCategory } from "@/modules/cash/types/category-types";

export const CATEGORIES_PAGE_SIZE = 5;

/* Page-shaped fetch for SearchableSelect's fetchFn contract
 * (GET /categories?type=&q=&limit=&offset=) — the categories shown on that
 * form: its own plus every common one. */
export function searchCategoriesPage(type: CategoryType) {
  return async (q: string, page: number): Promise<{ items: BackendCategory[]; hasMore: boolean }> => {
    const params = new URLSearchParams({ type, limit: String(CATEGORIES_PAGE_SIZE), offset: String(page * CATEGORIES_PAGE_SIZE) });
    if (q) params.set("q", q);
    const res = await apiFetch<{ items: BackendCategory[] | null; hasMore: boolean }>(`/categories?${params}`);
    const items = res.items || [];
    if (page !== 0 || !offlineReady()) return { items, hasMore: !!res.hasMore };
    // categories made on this PC for this form that the server has not accepted yet
    const needle = q.trim().toLowerCase();
    const known = new Set(items.map((i) => i.name.toLowerCase()));
    const pending = (listLocal("categories") as unknown as (BackendCategory & { type?: string })[])
      .filter((c) => c.type === type && (!needle || c.name.toLowerCase().includes(needle)) && !known.has(c.name.toLowerCase()));
    return { items: [...items, ...pending], hasMore: !!res.hasMore };
  };
}

/* Creates a category of `type`, or — when the name already exists (any
 * type) — returns that row, made common if it belonged to another form (the
 * backend's find-or-create rule). */
export function createCategory(type: CategoryType) {
  return async (name: string): Promise<BackendCategory> => {
    // Desktop: the category goes into the outbox first, is listed at once, and is sent from there.
    if (offlineReady()) {
      checkCategoryName(name, type === "cash_in");
      const entry = newEntry("POST", "/categories", { name, type }, currentActor());
      const draft = { id: -Math.floor(Math.random() * 1_000_000) - 1, name, type, uuid: entry.id } as unknown as BackendCategory;
      await enqueueAndWait(entry, () => upsertLocal("categories", draft as unknown as LocalRecord), () => removeLocal("categories", entry.id));
      return draft;
    }
    const rec = await apiFetch<BackendCategory>("/categories", {
      method: "POST",
      body: JSON.stringify({ name, type }),
    });
    if (typeof window !== "undefined") window.dispatchEvent(new Event(EXPENSE_CATEGORIES_CHANGED));
    return rec;
  };
}

/* Deletes a Credit / Debit / Self Transfer category. The backend refuses system categories, loan
 * categories and any category that ledger entries still use, answering with the reason. */
export async function deleteCategoryById(id: number): Promise<void> {
  await apiFetch<unknown>(`/categories/${id}`, { method: "DELETE" });
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EXPENSE_CATEGORIES_CHANGED));
}
