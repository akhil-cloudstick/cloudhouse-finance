"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "@/product/providers/auth-context";
import { listCustomers, type CustomerView } from "@/product/pages/customers/services/customerService";

type CustomersState = { customers: CustomerView[]; loading: boolean; error: string; refresh: () => void };

const CustomersContext = createContext<CustomersState | null>(null);

/**
 * Shared, real (backend-backed) customer list — read across many unrelated
 * pages (custOf lookups, GlobalSearch, New Loan's picker), unlike a single
 * "Add X" modal's branch dropdown, so a shared fetch-once-and-refresh
 * context earns its keep here (see the Customer Module stage-1 plan).
 */
export function CustomersProvider({ children }: { children: React.ReactNode }) {
  // Loaded for every page, so only fetched when this role can view the
  // module — otherwise it stays empty instead of failing with a 403.
  const { can, permissionsLoaded, selectedBranchId } = useAuth();
  const allowed = can("Customer_Management", "can_view_customer_module");
  const [customers, setCustomers] = useState<CustomerView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    if (!allowed) {
      setLoading(!permissionsLoaded);
      return;
    }
    setLoading(true);
    listCustomers()
      .then((list) => { setCustomers(list); setError(""); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load customers."))
      .finally(() => setLoading(false));
  }, [allowed, permissionsLoaded]);

  // Refetch when the global branch selector changes — the list is scoped
  // server-side by the X-Branch-Id header.
  useEffect(() => { refresh(); }, [refresh, selectedBranchId]);

  return (
    <CustomersContext.Provider value={{ customers, loading, error, refresh }}>
      {children}
    </CustomersContext.Provider>
  );
}

export function useCustomers() {
  const ctx = useContext(CustomersContext);
  if (!ctx) throw new Error("useCustomers must be used within a CustomersProvider");
  return ctx;
}
