import { apiRequestEnveloped as apiRequest } from "./client";
import { GoldRate } from "../types/goldRate";

export function listGoldRates() {
  return apiRequest<GoldRate[]>("/gold-rates");
}

// Page-scoped variant: passing `limit` flips the backend (goldrate/
// handler.go's List) into the {items, hasMore} envelope — used by the
// paginated mobile Gold Rates list (10/page, one API call per page).
export function listGoldRatesPage(params: { limit: number; offset: number }) {
  return apiRequest<{ items: GoldRate[]; hasMore: boolean }>("/gold-rates", { params });
}

export function latestGoldRate() {
  return apiRequest<GoldRate>("/gold-rates/latest");
}

export function publishGoldRate(input: { date?: string; k24: number; setBy: string }) {
  return apiRequest<GoldRate>("/gold-rates", { method: "POST", body: input });
}
