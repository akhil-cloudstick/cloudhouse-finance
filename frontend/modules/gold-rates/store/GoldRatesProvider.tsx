"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "@/common/providers/AuthProvider";
import { ApiError } from "@/common/services/httpClient";
import { listGoldRates, getLatestGoldRate } from "@/modules/gold-rates/services/goldRateService";
import { type GoldRateView } from "@/modules/gold-rates/types/gold-rate-types";

const EMPTY_RATE: GoldRateView = { id: "", date: "", k24: 0, k22: 0, k18: 0, setBy: "—" };

type GoldRatesState = {
  latest: GoldRateView;
  history: GoldRateView[];
  loading: boolean;
  error: string;
  refresh: () => void;
  /* Bumps every time a refresh completes, so views that page their own
   * history (GoldRates.tsx) can refetch after a rate is published. */
  version: number;
  /* True when `latest.date` ("YYYY-MM-DD") matches today's local date
   * string. False when no rate has ever been published (EMPTY_RATE, date
   * === "") or the newest published rate is from an earlier day — mirrors
   * the backend's loan.ErrGoldRateNotSetToday day-boundary check. */
  isTodaySet: boolean;
};

const GoldRatesContext = createContext<GoldRatesState | null>(null);

type GoldRatesProviderProps = { children: React.ReactNode };

/**
 * Shared, real (backend-backed) gold rate + history — read across Topbar,
 * Dashboard, GoldRates and NewLoan, mirroring CustomersProvider.tsx's
 * pattern. `latest` falls back to EMPTY_RATE (all zeros) when no rate has
 * ever been published yet (backend returns 404 for /gold-rates/latest).
 */
export function GoldRatesProvider({ children }: GoldRatesProviderProps) {
  // Loaded for every page, so only fetched when this role can view the
  // module — otherwise it stays empty instead of failing with a 403.
  const { can, permissionsLoaded } = useAuth();
  const allowed = can("Gold_Rate_Management", "can_view_gold_rate_module");
  const [latest, setLatest] = useState<GoldRateView>(EMPTY_RATE);
  const [history, setHistory] = useState<GoldRateView[]>([]);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    if (!allowed) {
      setLoading(!permissionsLoaded);
      return;
    }
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
        setVersion((v) => v + 1);
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load gold rates."))
      .finally(() => setLoading(false));
  }, [allowed, permissionsLoaded]);

  useEffect(() => { refresh(); }, [refresh]);

  // Matches the "YYYY-MM-DD" comparison convention used elsewhere (e.g.
  // Auctions.modules/cash/pages/CashPage.tsx/Dashboard.tsx's `today` const) and mirrors the
  // backend's loan.ErrGoldRateNotSetToday day-boundary check.
  const isTodaySet = !!latest.date && latest.date === new Date().toISOString().slice(0, 10);

  return (
    <GoldRatesContext.Provider value={{ latest, history, loading, error, refresh, version, isTodaySet }}>
      {children}
    </GoldRatesContext.Provider>
  );
}

export function useGoldRates() {
  const ctx = useContext(GoldRatesContext);
  if (!ctx) throw new Error("useGoldRates must be used within a GoldRatesProvider");
  return ctx;
}
