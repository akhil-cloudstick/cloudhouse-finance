"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "@/product/providers/auth-context";
import { listLoans, type LoanView } from "@/product/pages/loans/services/loanService";

type LoansState = { loans: LoanView[]; loading: boolean; error: string; refresh: () => void };

const LoansContext = createContext<LoansState | null>(null);

/**
 * Shared, real (backend-backed) loan list — mirrors CustomersProvider.tsx's
 * pattern exactly. Holds the full unfiltered list; pages (Loans.tsx,
 * Dashboard.tsx, CustomerDetail.tsx, GlobalSearch.tsx, Auctions.tsx,
 * BankPledge.tsx) filter client-side, matching the old mock db.loans usage.
 */
export function LoansProvider({ children }: { children: React.ReactNode }) {
  // Loaded for every page, so only fetched when this role can view the
  // module — otherwise it stays empty instead of failing with a 403.
  const { can, permissionsLoaded, selectedBranchId } = useAuth();
  const allowed = can("Loan_Management", "can_view_loan_module");
  const [loans, setLoans] = useState<LoanView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    if (!allowed) {
      setLoading(!permissionsLoaded);
      return;
    }
    setLoading(true);
    listLoans()
      .then((list) => { setLoans(list); setError(""); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load loans."))
      .finally(() => setLoading(false));
  }, [allowed, permissionsLoaded]);

  // Refetch when the global branch selector changes — the list is scoped
  // server-side by the X-Branch-Id header.
  useEffect(() => { refresh(); }, [refresh, selectedBranchId]);

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
