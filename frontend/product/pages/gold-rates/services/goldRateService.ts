import { apiFetchEnveloped as apiFetch } from "@/product/services/httpClient";
import { rateForKarat } from "@/product/utils/purity";

/* Shape returned by the Go backend (backend/internal/goldrate/model.go's
 * GoldRate). Every publish is an append-only row — there is no in-place
 * "current rate" record; the latest row by Date/ID is treated as current.
 * K24 is always published directly; K22/K18 can now ALSO be published
 * directly (Manual mode — see RateModalContent), independent of what
 * K24×ratio would derive, or left to carry forward from the previous
 * latest row. (These are new, live columns — not a revival of the old,
 * unrelated legacy_k22/legacy_k18 columns, which stay retired.) */
export type BackendGoldRate = {
  id: number;
  date: string; // RFC3339
  k24: number;
  k22: number;
  k18: number;
  setBy: string;
  createdAt: string;
};

/* UI-facing shape — field names match what GoldRates.tsx/RateModal.tsx/
 * Topbar.tsx/NewLoan.tsx/Dashboard.tsx already expect from the old
 * lib/data.ts Rates/RateHistoryEntry shapes. k22/k18 reflect whatever the
 * backend actually stored — a genuinely independently-published Manual
 * rate, an Auto-derived rate that was explicitly published, or (for rows
 * predating this feature, where the column is still its default zero) a
 * live client-side fallback computed off k24, same formula the backend
 * itself falls back to (see internal/loan/purity.go's rateForPurity). */
export type GoldRateView = {
  id: string;
  date: string; // "YYYY-MM-DD"
  k24: number;
  k22: number;
  k18: number;
  setBy: string;
};

/* karat: which single column this publish is setting (24, 22, or 18) —
 * Manual mode types `rate` directly for the chosen karat; Auto mode
 * computes `rate` client-side off the latest k24 and an editable
 * fineness%, then publishes it the same way. The other two columns carry
 * forward unchanged server-side (see backend PublishInput's doc comment).
 * `karat` defaults to 24 server-side when omitted, so any older caller
 * that only ever sent {k24, setBy} keeps working unchanged. */
export type GoldRatePublishInput = {
  karat: 24 | 22 | 18;
  rate: number;
  setBy: string;
};

function toView(r: BackendGoldRate): GoldRateView {
  return {
    id: String(r.id),
    date: r.date ? r.date.slice(0, 10) : "",
    k24: r.k24,
    k22: r.k22 > 0 ? r.k22 : rateForKarat(r.k24, 22),
    k18: r.k18 > 0 ? r.k18 : rateForKarat(r.k24, 18),
    setBy: r.setBy,
  };
}

export async function listGoldRates(): Promise<GoldRateView[]> {
  const rec = await apiFetch<BackendGoldRate[]>("/gold-rates");
  return (rec || []).map(toView);
}

export const GOLD_RATES_HISTORY_PAGE_SIZE = 10;

/* Paginated variant of listGoldRates — backs GoldRates.tsx's Rate History
 * table. `page` is 1-based; the backend responds with an {items, hasMore}
 * envelope whenever `limit` is passed (see backend/internal/goldrate/
 * handler.go's List), matching loansApi.listLoansPage's pattern. */
export async function listGoldRatesPage(
  page: number,
  limit?: number
): Promise<{ items: GoldRateView[]; hasMore: boolean; total: number }> {
  const pageSize = limit ?? (typeof window !== "undefined" && (window.innerWidth < 1600 || window.innerHeight < 950) ? 6 : 10);
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
  });
  const rec = await apiFetch<{ items: BackendGoldRate[]; hasMore: boolean; total?: number }>(`/gold-rates?${params}`);
  return { items: (rec?.items || []).map(toView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
}

export async function getLatestGoldRate(): Promise<GoldRateView | null> {
  const rec = await apiFetch<BackendGoldRate>("/gold-rates/latest");
  return rec ? toView(rec) : null;
}

export async function publishGoldRate(input: GoldRatePublishInput): Promise<GoldRateView> {
  const rec = await apiFetch<BackendGoldRate>("/gold-rates", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toView(rec);
}

/* Publishes every changed karat as ONE history row (keys 24/22/18). */
export async function publishGoldRates(rates: Partial<Record<24 | 22 | 18, number>>, setBy: string): Promise<GoldRateView> {
  const rec = await apiFetch<BackendGoldRate>("/gold-rates", {
    method: "POST",
    body: JSON.stringify({ rates, setBy }),
  });
  return toView(rec);
}
