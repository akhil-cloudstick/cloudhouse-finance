import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

// useState whose value is mirrored to sessionStorage under `key`, so a page's
// search/filter selections survive opening a detail page and coming back, a
// browser refresh, and visits to other pages. Cleared when the tab closes.
// Storage can be unavailable or hold junk — every access is guarded and the
// hook then behaves exactly like useState.
export function usePersistedState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const storageKey = `filters:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.sessionStorage.getItem(storageKey) : null;
      if (raw !== null) return JSON.parse(raw) as T;
    } catch { /* fall through to the default */ }
    return initial;
  });
  const set: Dispatch<SetStateAction<T>> = useCallback((next) => {
    setValue((prev) => {
      const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      try { window.sessionStorage.setItem(storageKey, JSON.stringify(resolved)); } catch { /* ignore */ }
      return resolved;
    });
  }, [storageKey]);
  return [value, set];
}

// Pages that belong to one area of the app. Search/filter state is kept while
// moving between pages of the SAME section (Ledger -> a party ledger -> a mode
// ledger, Loans -> a loan and back) and dropped when the user enters a
// different section (e.g. Customers). Routes not listed are their own section.
const SECTION_OF: Record<string, string> = {
  loans: "loans", loan: "loans", newloan: "loans",
  ledger: "ledger", "ledger-bank": "ledger", "ledger-customer": "ledger", "ledger-category": "ledger",
  "cash-ledger": "ledger", "upi-ledger": "ledger", "bank-transfer-ledger": "ledger", "cheque-ledger": "ledger",
  branches: "branches", "ledger-branch": "branches",
  customers: "customers", customer: "customers",
  personalloans: "personalloans", personalloan: "personalloans",
  investments: "investments", investment: "investments",
  packets: "packets", packet: "packets",
  banks: "banks", bankpledge: "bankpledge",
};

const SECTION_KEY = "filters-section";

// Detail pages a ledger row links out to (its loan / personal loan / investment
// / customer chip). Opening one from a ledger is a drill-down, not a change of
// area: the ledger's filters are kept so Back returns to the same filtered view.
const LEDGER_DRILLDOWNS = new Set(["loan", "personalloan", "investment", "customer"]);

// Called as the route changes (see AppShell). Entering a different section than
// the last one clears every remembered filter; a refresh stays in its section,
// so its filters survive.
export function syncFilterSection(route: string) {
  try {
    const section = SECTION_OF[route] ?? route;
    const last = window.sessionStorage.getItem(SECTION_KEY);
    if (last === section) return;
    if (last === "ledger" && LEDGER_DRILLDOWNS.has(route)) return;
    for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith("filters:")) window.sessionStorage.removeItem(k);
    }
    window.sessionStorage.setItem(SECTION_KEY, section);
  } catch { /* storage unavailable — nothing to keep or clear */ }
}
