"use client";

import { createContext, useCallback, useContext, useState } from "react";

type CustomersState = { version: number; refresh: () => void };

const CustomersContext = createContext<CustomersState | null>(null);

type CustomersProviderProps = { children: React.ReactNode };

/**
 * Customer-list change signal. It used to hold the full, unpaginated customer
 * list for every page; a business with tens of thousands of customers made that
 * one request per page load far too heavy, so every consumer now queries the
 * server (listCustomersPage / searchCustomersPage / getCustomer) and this only
 * tells them when a customer was added or changed (`version` bumps on refresh).
 */
export function CustomersProvider({ children }: CustomersProviderProps) {
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  return (
    <CustomersContext.Provider value={{ version, refresh }}>
      {children}
    </CustomersContext.Provider>
  );
}

export function useCustomers() {
  const ctx = useContext(CustomersContext);
  if (!ctx) throw new Error("useCustomers must be used within a CustomersProvider");
  return ctx;
}
