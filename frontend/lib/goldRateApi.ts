import { apiFetch } from "@/lib/api";

/* Shape returned by the Go backend (backend/internal/goldrate/model.go's
 * GoldRate). Every publish is an append-only row — there is no in-place
 * "current rate" record; the latest row by Date/ID is treated as current. */
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
 * lib/data.ts Rates/RateHistoryEntry shapes. */
export type GoldRateView = {
  id: string;
  date: string; // "YYYY-MM-DD"
  k24: number;
  k22: number;
  k18: number;
  setBy: string;
};

export type GoldRatePublishInput = {
  k24: number;
  k22: number;
  k18: number;
  setBy: string;
};

function toView(r: BackendGoldRate): GoldRateView {
  return {
    id: String(r.id),
    date: r.date ? r.date.slice(0, 10) : "",
    k24: r.k24,
    k22: r.k22,
    k18: r.k18,
    setBy: r.setBy,
  };
}

export async function listGoldRates(): Promise<GoldRateView[]> {
  const rec = await apiFetch<BackendGoldRate[]>("/gold-rates");
  return (rec || []).map(toView);
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
