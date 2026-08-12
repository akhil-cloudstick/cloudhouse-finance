import { apiFetch } from "@/lib/api";
import { rateForKarat } from "@/lib/purity";

/* Shape returned by the Go backend (backend/internal/goldrate/model.go's
 * GoldRate). Every publish is an append-only row — there is no in-place
 * "current rate" record; the latest row by Date/ID is treated as current.
 * Only K24 is published now — see that package's doc comment; the old
 * independently-entered k22/k18 columns were renamed to legacy_k22/
 * legacy_k18 server-side and are no longer part of the live API. */
export type BackendGoldRate = {
  id: number;
  date: string; // RFC3339
  k24: number;
  setBy: string;
  createdAt: string;
};

/* UI-facing shape — field names match what GoldRates.tsx/RateModal.tsx/
 * Topbar.tsx/NewLoan.tsx/Dashboard.tsx already expect from the old
 * lib/data.ts Rates/RateHistoryEntry shapes. k22/k18 are no longer
 * published values — they're computed client-side off k24 (see
 * lib/purity.ts's rateForKarat) purely as a reference display, distinct
 * from a real per-purity daily rate. */
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
  setBy: string;
};

function toView(r: BackendGoldRate): GoldRateView {
  return {
    id: String(r.id),
    date: r.date ? r.date.slice(0, 10) : "",
    k24: r.k24,
    k22: rateForKarat(r.k24, 22),
    k18: rateForKarat(r.k24, 18),
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
