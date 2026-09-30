import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";

/* Shape returned by the Go backend (backend/internal/cash/model.go's
 * CashSource) — a small find-or-create lookup list backing AddCashModal.tsx's
 * "Source of Cash" picker, same pattern as bank.Bank. */
export type BackendCashSource = {
  id: number;
  name: string;
  createdAt: string;
};

export const CASH_SOURCES_PAGE_SIZE = 5;

/* Page-shaped fetch for SearchableSelect's fetchFn contract — real
 * server-side pagination (GET /cash-sources?q=&limit=&offset=), unlike
 * bankService.ts's searchBanksPage which the bank list's small size lets
 * skip paging entirely. */
export async function searchCashSourcesPage(q: string, page: number): Promise<{ items: BackendCashSource[]; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: String(CASH_SOURCES_PAGE_SIZE), offset: String(page * CASH_SOURCES_PAGE_SIZE) });
  if (q) params.set("q", q);
  const res = await apiFetch<{ items: BackendCashSource[] | null; hasMore: boolean }>(`/cash-sources?${params}`);
  return { items: res.items || [], hasMore: !!res.hasMore };
}

/* Creates a new cash source, or — if one with the same name (case
 * insensitive) already exists — returns the existing row instead (the
 * backend's find-or-create behaviour). */
export async function createCashSource(name: string): Promise<BackendCashSource> {
  return apiFetch<BackendCashSource>("/cash-sources", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}
