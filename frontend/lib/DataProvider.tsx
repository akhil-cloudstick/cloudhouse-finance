"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { createDB, type DB } from "./data";

const DataContext = createContext<{ db: DB; refresh: () => void } | null>(null);

/**
 * Provides the shared `DB` object (ported from legacy/data.js) to the whole
 * admin app. Starts with build-safe seed defaults (no localStorage access,
 * safe for the static-export prerender pass), then re-hydrates with real
 * localStorage data once mounted in the browser — mirrors the same data,
 * same keys, same behavior as the legacy prototype.
 */
export function DataProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<DB>(() => createDB(false));

  const refresh = useCallback(() => {
    setDb(createDB(true));
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <DataContext.Provider value={{ db, refresh }}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within a DataProvider");
  return ctx;
}
