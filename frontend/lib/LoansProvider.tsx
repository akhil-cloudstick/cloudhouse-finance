"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { listLoans, type LoanView } from "./loansApi";

type LoansState = { loans: LoanView[]; loading: boolean; error: string; refresh: () => void };

const LoansContext = createContext<LoansState | null>(null);

/**
 * Shared, real (backend-backed) loan list — mirrors CustomersProvider.tsx's
 * pattern exactly. Holds the full unfiltered list; pages (Loans.tsx,
 * Dashboard.tsx, CustomerDetail.tsx, GlobalSearch.tsx, Auctions.tsx,
 * BankPledge.tsx) filter client-side, matching the old mock db.loans usage.
 */
export function LoansProvider({ children }: { children: React.ReactNode }) {
  const [loans, setLoans] = useState<LoanView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    setLoading(true);
    listLoans()
      .then((list) => { setLoans(list); setError(""); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load loans."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <LoansContext.Provider value={{ loans, loading, error, refresh }}>
      {children}
    </LoansContext.Provider>
  );
}

export function useLoans() {
  const ctx = useContext(LoansContext);
  if (!ctx) throw new Error("useLoans must be used within a LoansProvider");
  return ctx;
}
