"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { listGoldRates, getLatestGoldRate, type GoldRateView } from "@/lib/goldRateApi";

const EMPTY_RATE: GoldRateView = { id: "", date: "", k24: 0, k22: 0, k18: 0, setBy: "—" };

type GoldRatesState = {
  latest: GoldRateView;
  history: GoldRateView[];
  loading: boolean;
  error: string;
  refresh: () => void;
  /* True when `latest.date` ("YYYY-MM-DD") matches today's local date
   * string. False when no rate has ever been published (EMPTY_RATE, date
   * === "") or the newest published rate is from an earlier day — mirrors
   * the backend's loan.ErrGoldRateNotSetToday day-boundary check. */
  isTodaySet: boolean;
};

const GoldRatesContext = createContext<GoldRatesState | null>(null);

/**
 * Shared, real (backend-backed) gold rate + history — read across Topbar,
 * Dashboard, GoldRates and NewLoan, mirroring CustomersProvider.tsx's
 * pattern. `latest` falls back to EMPTY_RATE (all zeros) when no rate has
 * ever been published yet (backend returns 404 for /gold-rates/latest).
 */
export function GoldRatesProvider({ children }: { children: React.ReactNode }) {
  const [latest, setLatest] = useState<GoldRateView>(EMPTY_RATE);
  const [history, setHistory] = useState<GoldRateView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    setLoading(true);
    Promise.all([
      getLatestGoldRate().catch((e) => {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }),
      listGoldRates(),
    ])
      .then(([latestRate, hist]) => {
        setLatest(latestRate || EMPTY_RATE);
        // Newest first, matching the old rateHistory[0] = most-recent convention.
        setHistory([...hist].sort((a, b) => (a.id < b.id ? 1 : -1)));
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load gold rates."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Matches the "YYYY-MM-DD" comparison convention used elsewhere (e.g.
  // Auctions.tsx/Cash.tsx/Dashboard.tsx's `today` const) and mirrors the
  // backend's loan.ErrGoldRateNotSetToday day-boundary check.
  const isTodaySet = !!latest.date && latest.date === new Date().toISOString().slice(0, 10);

  return (
    <GoldRatesContext.Provider value={{ latest, history, loading, error, refresh, isTodaySet }}>
      {children}
    </GoldRatesContext.Provider>
  );
}

export function useGoldRates() {
  const ctx = useContext(GoldRatesContext);
  if (!ctx) throw new Error("useGoldRates must be used within a GoldRatesProvider");
  return ctx;
}
