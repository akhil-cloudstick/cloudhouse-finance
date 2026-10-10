import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";

// Mirrors backend/internal/goldrate/model.go's GoldRate.
export type GoldRate = {
  id: number;
  date: string;
  k24: number;
  setBy: string;
  createdAt: string;
};

// GET /customer/gold-rate/latest — the current published 24K benchmark.
export function getLatest(): Promise<GoldRate> {
  return apiRequest("/gold-rate/latest");
}

// GET /customer/gold-rate/history?limit=N — most recent N rates, newest
// first. Mirrors goldrate.Handler.List's paginated shape ({items, hasMore})
// used whenever a limit is given.
export function getHistory(limit = 30): Promise<{ items: GoldRate[]; hasMore: boolean }> {
  return apiRequest("/gold-rate/history", { params: { limit } });
}
