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
  version: number; // bumps on every refresh so pages depending on history can refetch
  isTodaySet: boolean; // true when latest.date matches today's local date
};

const GoldRatesContext = createContext<GoldRatesState | null>(null);

type GoldRatesProviderProps = { children: React.ReactNode };

// `latest` falls back to EMPTY_RATE when no rate has ever been published yet (404 for /gold-rates/latest).
export function GoldRatesProvider({ children }: GoldRatesProviderProps) {
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
        setHistory([...hist].sort((a, b) => (a.id < b.id ? 1 : -1))); // newest first
        setVersion((v) => v + 1);
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load gold rates."))
      .finally(() => setLoading(false));
  }, [allowed, permissionsLoaded]);

  useEffect(() => { refresh(); }, [refresh]);

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
