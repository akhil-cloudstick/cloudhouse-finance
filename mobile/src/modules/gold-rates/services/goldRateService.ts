import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import { GoldRate } from "@/modules/gold-rates/types/gold-rate-types";

export function listGoldRates() {
  return apiRequest<GoldRate[]>("/gold-rates");
}

// Page-scoped variant: passing `limit` flips the backend (goldrate/
// handler.go's List) into the {items, hasMore} envelope — used by the
// paginated mobile Gold Rates list (10/page, one API call per page).
export function listGoldRatesPage(params: { limit: number; offset: number }) {
  return apiRequest<{ items: GoldRate[]; hasMore: boolean }>("/gold-rates", { params });
}

// The designation arrives as `set_by_designation` (the API layer has no rename for it).
type RawGoldRate = GoldRate & { set_by_designation?: string; entries?: RawGoldRate[] };
const normaliseRate = (r: RawGoldRate): GoldRate => ({
  ...r,
  date: r.date ? r.date.slice(0, 10) : "",
  setByDesignation: r.setByDesignation ?? r.set_by_designation ?? "",
  entries: r.entries?.map(normaliseRate),
});

/** Gold Rates page: one row per day (its newest rate, with that day's changes in `entries`) — the same listing,
 * search and filters (date range, set by) as the web Gold Rates page (frontend listGoldRateDaysPage). */
export async function listGoldRateDaysPage(params: { limit: number; offset: number; q?: string; from?: string; to?: string; setBy?: string[] }) {
  const rec = await apiRequest<{ items: RawGoldRate[] | null; hasMore: boolean; total?: number }>("/gold-rates", {
    params: {
      limit: params.limit,
      offset: params.offset,
      group: "day",
      search: params.q?.trim() || undefined,
      from: params.from || undefined,
      to: params.to || undefined,
      set_by: params.setBy?.length ? params.setBy.join(",") : undefined,
    },
  });
  return { items: (rec?.items ?? []).map(normaliseRate), hasMore: !!rec?.hasMore, total: rec?.total };
}

export function latestGoldRate() {
  return apiRequest<GoldRate>("/gold-rates/latest");
}

// Manual/Auto-mode publish — sends {karat, rate, setBy} for whichever karat
// is being set this time (24/22/18); the backend carries the other two
// columns forward unchanged from the previous latest row (see backend/
// internal/goldrate/service.go's Publish, handler.go's publishRequest).
// Mirrors frontend/modules/gold-rates/services/goldRateService.ts's
// publishGoldRate exactly.
export function publishGoldRate(input: { date?: string; karat: 24 | 22 | 18; rate: number; setBy: string }) {
  return apiRequest<GoldRate>("/gold-rates", { method: "POST", body: input });
}

// Publishes every changed karat as ONE history row (keys 24/22/18) — same as web's
// publishGoldRates; the backend carries any karat left out forward unchanged.
export function publishGoldRates(rates: Partial<Record<24 | 22 | 18, number>>, setBy: string, date?: string) {
  return apiRequest<GoldRate>("/gold-rates", { method: "POST", body: { rates, setBy, ...(date ? { date } : {}) } });
}
