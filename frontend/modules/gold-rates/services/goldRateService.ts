import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import { rateForKarat, finenessFromRate } from "@/common/utils/purity";
import type { BackendGoldRate, GoldRateView, GoldRatePublishInput } from "@/modules/gold-rates/types/gold-rate-types";

function toView(r: BackendGoldRate): GoldRateView {
  const k22 = r.k22 > 0 ? r.k22 : rateForKarat(r.k24, 22);
  const k18 = r.k18 > 0 ? r.k18 : rateForKarat(r.k24, 18);
  return {
    id: String(r.id),
    date: r.date ? r.date.slice(0, 10) : "",
    k24: r.k24,
    k22,
    k18,
    // Rows from before fineness was stored fall back to what their rates imply.
    fineness22: r.fineness22 && r.fineness22 > 0 ? r.fineness22 : finenessFromRate(r.k24, k22, 22),
    fineness18: r.fineness18 && r.fineness18 > 0 ? r.fineness18 : finenessFromRate(r.k24, k18, 18),
    setBy: r.setBy,
    setByDesignation: r.setByDesignation || "",
    createdAt: r.createdAt || "",
    entries: r.entries?.map(toView),
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

/* Rate History table: one item per calendar day — the day's newest rate, with
 * every change of that day in `entries`. `from` / `to` ("YYYY-MM-DD") narrow to a range of days. */
export async function listGoldRateDaysPage(
  page: number,
  limit: number,
  from?: string,
  to?: string,
  q?: string
): Promise<{ items: GoldRateView[]; hasMore: boolean; total: number }> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String((page - 1) * limit),
    group: "day",
  });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (q?.trim()) params.set("search", q.trim());
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

/* Publishes every changed karat as ONE history row (keys 24/22/18). `fineness` (keys 22/18) saves the Auto-mode
 * fineness with it; omitted, the last one carries forward. */
export async function publishGoldRates(rates: Partial<Record<24 | 22 | 18, number>>, setBy: string, fineness?: Partial<Record<22 | 18, number>>, date?: string): Promise<GoldRateView> {
  const rec = await apiFetch<BackendGoldRate>("/gold-rates", {
    method: "POST",
    body: JSON.stringify({ rates, setBy, ...(fineness ? { fineness } : {}), ...(date ? { date } : {}) }),
  });
  return toView(rec);
}
