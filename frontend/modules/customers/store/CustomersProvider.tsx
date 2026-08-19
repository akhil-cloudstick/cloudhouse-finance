"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { listCustomers, type CustomerView } from "@/modules/customers/services/customerService";

type CustomersState = { customers: CustomerView[]; loading: boolean; error: string; refresh: () => void };

const CustomersContext = createContext<CustomersState | null>(null);

/**
 * Shared, real (backend-backed) customer list — read across many unrelated
 * pages (custOf lookups, GlobalSearch, New Loan's picker), unlike a single
 * "Add X" modal's branch dropdown, so a shared fetch-once-and-refresh
 * context earns its keep here (see the Customer Module stage-1 plan).
 */
export function CustomersProvider({ children }: { children: React.ReactNode }) {
  const [customers, setCustomers] = useState<CustomerView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    setLoading(true);
    listCustomers()
      .then((list) => { setCustomers(list); setError(""); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load customers."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

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
