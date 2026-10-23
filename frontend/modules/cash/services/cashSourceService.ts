import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import { enqueueAndWait, listLocal, newEntry, offlineReady, removeLocal, upsertLocal, type LocalRecord } from "@/common/offline";
import { currentActor } from "@/common/offline/actor";
import type { BackendLoanCashSource } from "@/modules/cash/types/cash-types";
import type { BackendCashSource, LoanBalance } from "@/modules/cash/types/cash-source-types";

/* A source whose name starts with "Loan" (any case) is one bank loan —
 * mirrors backend/internal/cash/service.go's IsLoanSource. */
export function isLoanSource(name: string): boolean {
  return name.trim().toLowerCase().startsWith("loan");
}

export const CASH_SOURCES_PAGE_SIZE = 5;

/* Page-shaped fetch for SearchableSelect's fetchFn contract — real
 * server-side pagination (GET /cash-sources?q=&limit=&offset=), unlike
 * bankService.ts's searchBanksPage which the bank list's small size lets
 * skip paging entirely. */
/* Categories made on this PC that the server has not accepted yet, narrowed by the search text. */
function pendingCategories(q: string): BackendCashSource[] {
  if (!offlineReady()) return [];
  const needle = q.trim().toLowerCase();
  return (listLocal("categories") as unknown as (BackendCashSource & { type?: string })[]).filter((c) => (!c.type || c.type === "cash_in") && (!needle || c.name.toLowerCase().includes(needle)));
}

export async function searchCashSourcesPage(q: string, page: number): Promise<{ items: BackendCashSource[]; hasMore: boolean }> {
  const r = await searchCashSourcesLive(q, page);
  if (page !== 0) return r;
  const known = new Set(r.items.map((i) => i.name.toLowerCase()));
  return { ...r, items: [...r.items, ...pendingCategories(q).filter((c) => !known.has(c.name.toLowerCase()))] };
}

async function searchCashSourcesLive(q: string, page: number): Promise<{ items: BackendCashSource[]; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: String(CASH_SOURCES_PAGE_SIZE), offset: String(page * CASH_SOURCES_PAGE_SIZE) });
  if (q) params.set("q", q);
  const res = await apiFetch<{ items: BackendCashSource[] | null; hasMore: boolean }>(`/cash-sources?${params}`);
  return { items: res.items || [], hasMore: !!res.hasMore };
}

/* Distinct loan numbers already recorded as a "Loan" cash source, newest
 * details per loan — AddCashModal.tsx's Loan Number picker, so one loan can
 * be drawn against across several Add Cash entries. */
export async function searchLoanSourcesPage(q: string, page: number): Promise<{ items: BackendLoanCashSource[]; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: String(CASH_SOURCES_PAGE_SIZE), offset: String(page * CASH_SOURCES_PAGE_SIZE) });
  if (q) params.set("q", q);
  const res = await apiFetch<{ items: BackendLoanCashSource[] | null; hasMore: boolean }>(`/cash-movements/loan-sources?${params}`);
  return { items: res.items || [], hasMore: !!res.hasMore };
}

/* Creates a new cash source, or — if one with the same name (case
 * insensitive) already exists — returns the existing row instead (the
 * backend's find-or-create behaviour). */
export async function createCashSource(name: string): Promise<BackendCashSource> {
  // Desktop: the category goes into the outbox first, is listed at once, and is sent from there.
  if (offlineReady()) {
    const entry = newEntry("POST", "/cash-sources", { name }, currentActor());
    // a temporary negative id keeps it distinct in the picker; the server's own list replaces it once sent
    const draft = { id: -Math.floor(Math.random() * 1_000_000) - 1, name, type: "cash_in", uuid: entry.id } as unknown as BackendCashSource;
    await enqueueAndWait(entry, () => upsertLocal("categories", draft as unknown as LocalRecord), () => removeLocal("categories", entry.id));
    return draft;
  }
  return createCashSourceLive(name);
}

async function createCashSourceLive(name: string): Promise<BackendCashSource> {
  return apiFetch<BackendCashSource>("/cash-sources", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

/* GET /cash-sources/:id — the category with its current loan balance. The id is
 * a category id (cash sources, expense categories and self-transfer categories
 * are one table), so a loan picked on any form resolves here. */
export async function getLoanBalance(id: number): Promise<LoanBalance | null> {
  const res = await apiFetch<{ isLoan: boolean; balance: LoanBalance }>(`/cash-sources/${id}`);
  return res.isLoan ? res.balance : null;
}

