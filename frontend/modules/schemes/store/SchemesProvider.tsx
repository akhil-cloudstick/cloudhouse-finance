"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { listSchemes, type SchemeView } from "@/modules/schemes/services/schemeService";

type SchemesState = { schemes: SchemeView[]; loading: boolean; error: string; refresh: () => void };

const SchemesContext = createContext<SchemesState | null>(null);

/**
 * Shared, real (backend-backed) scheme list. Schemes.tsx itself was wired
 * to the real API in an earlier stage, but schemeOf() (format.ts) and its
 * call sites (Dashboard, GlobalSearch, LoanDetail, LoanRow, NewLoan) were
 * left reading the stale mock db.schemes — this closes that gap the same
 * way CustomersProvider does for customers.
 */
export function SchemesProvider({ children }: { children: React.ReactNode }) {
  const [schemes, setSchemes] = useState<SchemeView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    setLoading(true);
    listSchemes()
      .then((list) => { setSchemes(list); setError(""); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load schemes."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <SchemesContext.Provider value={{ schemes, loading, error, refresh }}>
      {children}
    </SchemesContext.Provider>
  );
}

export function useSchemes() {
  const ctx = useContext(SchemesContext);
  if (!ctx) throw new Error("useSchemes must be used within a SchemesProvider");
  return ctx;
}
