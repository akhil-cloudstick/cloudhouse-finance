"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "@/common/providers/AuthProvider";
import { listCustomers } from "@/modules/customers/services/customerService";
import { type CustomerView } from "@/modules/customers/types/customer-types";

type CustomersState = { customers: CustomerView[]; loading: boolean; error: string; refresh: () => void };

const CustomersContext = createContext<CustomersState | null>(null);

type CustomersProviderProps = { children: React.ReactNode };

export function CustomersProvider({ children }: CustomersProviderProps) {
  // Loaded for every page, so only fetched when this role can view the module (else a 403 on every load).
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

  // Refetch when the global branch selector changes: the list is scoped server-side by X-Branch-Id.
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
