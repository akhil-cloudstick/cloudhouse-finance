"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "@/common/providers/AuthProvider";
import { listSchemes } from "@/modules/schemes/services/schemeService";
import { type SchemeView } from "@/modules/schemes/types/scheme-types";

type SchemesState = { schemes: SchemeView[]; loading: boolean; error: string; refresh: () => void };

const SchemesContext = createContext<SchemesState | null>(null);

type SchemesProviderProps = { children: React.ReactNode };

/**
 * Shared, real (backend-backed) scheme list. Schemes.tsx itself was wired
 * to the real API in an earlier stage, but schemeOf() (format.ts) and its
 * call sites (Dashboard, GlobalSearch, LoanDetail, LoanRow, NewLoan) were
 * left reading the stale mock db.schemes — this closes that gap the same
 * way CustomersProvider does for customers.
 */
export function SchemesProvider({ children }: SchemesProviderProps) {
  // Loaded for every page, so only fetched when this role can view the
  // module — otherwise it stays empty instead of failing with a 403.
  const { can, permissionsLoaded, selectedBranchId } = useAuth();
  const allowed = can("Scheme_Management", "can_view_scheme_module");
  const [schemes, setSchemes] = useState<SchemeView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    if (!allowed) {
      setLoading(!permissionsLoaded);
      return;
    }
    setLoading(true);
    listSchemes()
      .then((list) => { setSchemes(list); setError(""); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load schemes."))
      .finally(() => setLoading(false));
  }, [allowed, permissionsLoaded]);

  // Refetch when the global branch selector changes — the list is scoped
  // server-side by the X-Branch-Id header.
  useEffect(() => { refresh(); }, [refresh, selectedBranchId]);

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
