import { checkCategoryName } from "./cashOfflineChecks";
import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import { changeWithEntry, enqueueAndWait, listLocal, newEntry, offlineReady, removeLocal, upsertLocal, type LocalRecord } from "@/common/offline";
import { queueWrite } from "@/common/offline/queueWrite";
import { ApiError } from "@/common/services/httpClient";
import { currentActor } from "@/common/offline/actor";
import { ledgerRowToView } from "./cashService";
import { type BackendLedgerRow, type LedgerRowView } from "@/modules/cash/types/cash-types";
import type { BackendExpenseCategory, LoanLedgerSummary } from "@/modules/cash/types/expense-category-types";

export const EXPENSE_CATEGORIES_PAGE_SIZE = 5;

/* Page-shaped fetch for SearchableSelect's fetchFn contract — real
 * server-side pagination (GET /expense-categories?q=&limit=&offset=). */
export async function searchExpenseCategoriesPage(q: string, page: number): Promise<{ items: BackendExpenseCategory[]; hasMore: boolean }> {
  const r = await searchExpenseCategoriesLive(q, page);
  if (page !== 0 || !offlineReady()) return r;
  const needle = q.trim().toLowerCase();
  const known = new Set(r.items.map((i) => i.name.toLowerCase()));
  const pending = (listLocal("categories") as unknown as BackendExpenseCategory[]).filter((c) => (!c.type || c.type === "expense") && (!needle || c.name.toLowerCase().includes(needle)) && !known.has(c.name.toLowerCase()));
  return { ...r, items: [...r.items, ...pending] };
}

async function searchExpenseCategoriesLive(q: string, page: number): Promise<{ items: BackendExpenseCategory[]; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: String(EXPENSE_CATEGORIES_PAGE_SIZE), offset: String(page * EXPENSE_CATEGORIES_PAGE_SIZE) });
  if (q) params.set("q", q);
  const res = await apiFetch<{ items: BackendExpenseCategory[] | null; hasMore: boolean }>(`/expense-categories?${params}`);
  return { items: res.items || [], hasMore: !!res.hasMore };
}

/* Expense-form dropdown: same as above minus the system categories (Auction,
 * Bank Pledge Release) that are filed automatically. They stay in the plain
 * list so their category ledgers keep resolving. */
export async function searchSelectableExpenseCategoriesPage(q: string, page: number): Promise<{ items: BackendExpenseCategory[]; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: String(EXPENSE_CATEGORIES_PAGE_SIZE), offset: String(page * EXPENSE_CATEGORIES_PAGE_SIZE), selectable: "1" });
  if (q) params.set("q", q);
  const res = await apiFetch<{ items: BackendExpenseCategory[] | null; hasMore: boolean }>(`/expense-categories?${params}`);
  return { items: res.items || [], hasMore: !!res.hasMore };
}

/* Creates a new expense category, or — if one with the same name (case
 * insensitive) already exists — returns the existing row instead (the
 * backend's find-or-create behaviour). */
// Fired by createExpenseCategory so every mounted useExpenseCategoryIds
// reloads — otherwise a category added from ExpenseModal has no ledger link
// until the page is refreshed.
export const EXPENSE_CATEGORIES_CHANGED = "expense-categories-changed";

function notifyExpenseCategoriesChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EXPENSE_CATEGORIES_CHANGED));
}

export async function createExpenseCategory(name: string): Promise<BackendExpenseCategory> {
  // Desktop: the category goes into the outbox first, is listed at once, and is sent from there.
  if (offlineReady()) {
    checkCategoryName(name, false);
    const entry = newEntry("POST", "/expense-categories", { name }, currentActor());
    const draft = { id: -Math.floor(Math.random() * 1_000_000) - 1, name, type: "expense", uuid: entry.id, createdAt: new Date().toISOString() } as unknown as BackendExpenseCategory;
    await enqueueAndWait(entry, () => upsertLocal("categories", draft as unknown as LocalRecord), () => removeLocal("categories", entry.id));
    return draft;
  }
  const rec = await apiFetch<BackendExpenseCategory>("/expense-categories", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  // Lets every category-ledger link resolve the new category straight away.
  notifyExpenseCategoriesChanged();
  return rec;
}

/* Deletes an expense category. The backend refuses system categories and any category
 * that ledger entries still use, answering with the reason. */
export async function deleteExpenseCategory(id: number): Promise<void> {
  if (offlineReady()) {
    await deleteCategoryQueued(id, `/expense-categories/${id}`);
    notifyExpenseCategoriesChanged();
    return;
  }
  await apiFetch<unknown>(`/expense-categories/${id}`, { method: "DELETE" });
  notifyExpenseCategoriesChanged();
}

/* Offline delete of a category (either list: both are DELETE on the same server rule, deleteCategory). The server's own refusals are
 * raised here in its words, then the delete is queued and the category leaves the lists at once (see referenceAdjust.ts). A category
 * made on this PC and not sent yet is simply taken back. */
export async function deleteCategoryQueued(id: number, path: string): Promise<void> {
  const mine = (listLocal("categories") as unknown as (BackendExpenseCategory & { uuid: string })[]).find((c) => c.id === id);
  if (id < 0) {
    if (!mine) throw new ApiError("Not synced yet. Try again once it has synced.", 409);
    try {
      await changeWithEntry(mine.uuid, "", () => removeLocal("categories", mine.uuid));
    } catch {
      throw new ApiError("It was sent while you were deleting it. Refresh, then delete it.", 409);
    }
    return;
  }
  // the ledger of the category gives its name and the entries that still use it (the server counts these by name)
  const ledger = await apiFetch<{ total?: number; categoryName?: string; loan?: unknown }>(`${categoryLedgerPath(id)}?limit=1&offset=0`).catch(() => null);
  const name = (ledger?.categoryName ?? "").trim();
  if (/^(auction|bank pledge release)$/i.test(name)) {
    throw new ApiError("This category cannot be deleted — this is a system category used automatically by the auction and bank pledge flows.", 409);
  }
  const used = ledger?.total ?? 0;
  if (used > 0) throw new ApiError(`This category cannot be deleted — ${used} ledger entr${used === 1 ? "y" : "ies"} still use it.`, 409);
  await queueWrite("DELETE", path, undefined, undefined, async () => {
    await apiFetch<unknown>(path, { method: "DELETE" });
  });
}

export const EXPENSE_CATEGORY_LEDGER_PAGE_SIZE = 12;

/* The category-ledger endpoint — used for the JSON drill-down below and the
 * PDF export in cashService.ts. A function declaration, so it is hoisted for
 * cashService (which this file also imports from). */
export function categoryLedgerPath(categoryId: number | string): string {
  return `/expense-categories/${categoryId}/ledger`;
}

/* Category ledger drill-down — every Expense recorded under this category,
 * as the same combined LedgerRow shape the bank/customer/loan ledgers use
 * (backend/internal/cash/ledger.go's ListLedgerByCategory). Matches by name
 * server-side (Expense.Category is still free text, no CategoryID FK yet —
 * see that function's own doc comment), so the id here is only used to
 * resolve which category, not as a join key on Expense itself. */
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
