import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";

export type GoldRate = {
  id: number;
  date: string;
  k24: number;
  setBy: string;
  createdAt: string;
};

export function getLatest(): Promise<GoldRate> {
  return apiRequest("/gold-rate/latest");
}

export function getHistory(limit = 30): Promise<{ items: GoldRate[]; hasMore: boolean }> {
  return apiRequest("/gold-rate/history", { params: { limit } });
}
