"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "@/common/providers/AuthProvider";
import { ApiError } from "@/common/services/httpClient";
import { subscribeLocal } from "@/common/offline";
import { ENTRIES_SENT_EVENT } from "@/common/offline/live";
import { listLoans } from "@/modules/loans/services/loanService";
import { type LoanView } from "@/modules/loans/types/loan-types";

type LoansState = { loans: LoanView[]; loading: boolean; error: string; refresh: () => void };

const LoansContext = createContext<LoansState | null>(null);

type LoansProviderProps = { children: React.ReactNode };

/* Loans that are still being serviced. Closed, Rejected and Auctioned loans are
 * never needed in this shared list (they only appear in paged/server queries),
 * and a business with a long history can hold hundreds of thousands of them —
 * loading those on every page would exhaust the backend's memory. */
export const OPEN_LOAN_STATUSES = [
  "Pending Approval",
  "Active",
  "Due Soon",
  "Overdue",
  "Closure Requested",
  "Auction Eligible",
  "Auctioned - Balance Due",
];

/**
 * Shared, real (backend-backed) list of the open loan book (OPEN_LOAN_STATUSES).
 * Pages (Dashboard.tsx, Auctions.tsx) filter it client-side for KPIs and the
 * auction pipeline; anything that needs closed loans queries the server paged.
 */
export function LoansProvider({ children }: LoansProviderProps) {
  // Loaded for every page, so only fetched when this role can view the
  // module — otherwise it stays empty instead of failing with a 403.
  const { can, permissionsLoaded, selectedBranchId } = useAuth();
  const allowed = can("Loan_Management", "can_view_loan_module");
  const [loans, setLoans] = useState<LoanView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // set when the server could not be reached before this PC's own copy was ready: the list is read again from the
  // copy as soon as it is loaded, and nothing is shown to the user meanwhile
  const retryOnLocal = useRef(false);

  const refresh = useCallback(() => {
    if (!allowed) {
      setLoading(!permissionsLoaded);
      return;
    }
    setLoading(true);
    listLoans({ status: OPEN_LOAN_STATUSES })
      .then((list) => { setLoans(list); setError(""); })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 0) {
          retryOnLocal.current = true;
          setError("");
        } else setError(e instanceof Error ? e.message : "Failed to load loans.");
      })
      .finally(() => setLoading(false));
  }, [allowed, permissionsLoaded]);

  // Refetch when the global branch selector changes — the list is scoped
  // server-side by the X-Branch-Id header.
  useEffect(() => { refresh(); }, [refresh, selectedBranchId]);

  useEffect(
    () =>
      subscribeLocal(() => {
        if (!retryOnLocal.current) return;
        retryOnLocal.current = false;
        refresh();
      }),
    [refresh],
  );

  // entries this PC sent have changed the server's loans: read the list again
  useEffect(() => {
    const again = () => refresh();
    window.addEventListener(ENTRIES_SENT_EVENT, again);
    return () => window.removeEventListener(ENTRIES_SENT_EVENT, again);
  }, [refresh]);

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
