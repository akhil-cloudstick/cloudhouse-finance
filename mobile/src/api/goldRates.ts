import { apiRequestEnveloped as apiRequest } from "./client";
import { GoldRate } from "../types/goldRate";

export function listGoldRates() {
  return apiRequest<GoldRate[]>("/gold-rates");
}

export function latestGoldRate() {
  return apiRequest<GoldRate>("/gold-rates/latest");
}

export function publishGoldRate(input: { date?: string; k24: number; setBy: string }) {
  return apiRequest<GoldRate>("/gold-rates", { method: "POST", body: input });
}
