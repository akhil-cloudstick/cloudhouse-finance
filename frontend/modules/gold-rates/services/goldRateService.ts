import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import { rateForKarat } from "@/common/utils/purity";
import type { BackendGoldRate, GoldRateView, GoldRatePublishInput } from "@/modules/gold-rates/types/gold-rate-types";

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
