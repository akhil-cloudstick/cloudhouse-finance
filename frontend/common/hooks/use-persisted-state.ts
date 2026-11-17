import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

// In-memory store (NOT sessionStorage/localStorage): filter selections live in the
// running JS context only, so they survive in-app navigation (open a record and
// press Back) but are gone after a browser refresh.
const store = new Map<string, unknown>();

// useState whose value is mirrored to the in-memory store under `key`, so a page's
// search/filter selections survive opening a detail page and coming back, but NOT a
// browser refresh.
export function usePersistedState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const storageKey = `filters:${key}`;
  const [value, setValue] = useState<T>(() => (store.has(storageKey) ? (store.get(storageKey) as T) : initial));
  const set: Dispatch<SetStateAction<T>> = useCallback((next) => {
    setValue((prev) => {
      const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      store.set(storageKey, resolved);
      return resolved;
    });
  }, [storageKey]);
  return [value, set];
}

// A list's current page, kept like the search/filter selections so that opening
// a record and pressing Back returns to the same page instead of page 1.
export function usePersistedPage(key: string): [number, Dispatch<SetStateAction<number>>] {
  return usePersistedState<number>(`${key}:page`, 1);
}

// Sends the list back to page 1 when `deps` (its search / filters / page size)
// change. Not on mount: the page restored by usePersistedPage must survive the
// first render (also under StrictMode's mount, unmount, mount).
export function useResetPageOnChange(setPage: (page: number) => void, deps: readonly unknown[]): void {
  const mounted = useRef(false);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// Pages that belong to one area of the app. Search/filter state is kept while
// moving between pages of the SAME section (Ledger -> a party ledger -> a mode
// ledger, Loans -> a loan and back) and dropped when the user enters a
// different section (e.g. Customers). Routes not listed are their own section.
const SECTION_OF: Record<string, string> = {
  loans: "loans", loan: "loans", newloan: "loans", editloan: "loans",
  ledger: "ledger", "ledger-bank": "ledger", "ledger-customer": "ledger", "ledger-category": "ledger",
  "cash-ledger": "ledger", "upi-ledger": "ledger", "bank-transfer-ledger": "ledger", "cheque-ledger": "ledger",
  branches: "branches", "ledger-branch": "branches",
  customers: "customers", customer: "customers",
  personalloans: "personalloans", personalloan: "personalloans",
  investments: "investments", investment: "investments",
  packets: "packets", packet: "packets",
  banks: "banks", bankpledge: "bankpledge",
};

let lastSection: string | null = null;

// Detail pages a ledger row links out to (its loan / personal loan / investment
// / customer chip). Opening one from a ledger is a drill-down, not a change of
// area: the ledger's filters are kept so Back returns to the same filtered view.
const LEDGER_DRILLDOWNS = new Set(["loan", "personalloan", "investment", "customer"]);

// Lists whose rows open a loan: opening one is a drill-down too, so Back returns to the same page and filters.
const LOAN_DRILLDOWNS = new Set(["loan"]);
const DRILLDOWNS_FROM: Record<string, Set<string>> = {
  ledger: LEDGER_DRILLDOWNS,
  auctions: LOAN_DRILLDOWNS,
  bankpledge: LOAN_DRILLDOWNS,
  reports: LOAN_DRILLDOWNS,
};

// Called as the route changes (see AppShell). Entering a different section than
// the last one clears every remembered filter.
export function syncFilterSection(route: string) {
  const section = SECTION_OF[route] ?? route;
  const last = lastSection;
  if (last === section) return;
  if (last && DRILLDOWNS_FROM[last]?.has(route)) return;
  store.clear();
  lastSection = section;
}

// Search text is not remembered across pages: leaving a page and coming back
// (or opening a detail and pressing Back) starts from a fresh, unsearched list.
let lastRoute: string | null = null;
export function resetSearchOnNavigation(route: string) {
  if (route === lastRoute) return;
  const had = lastRoute !== null;
  lastRoute = route;
  if (!had) return;
  for (const k of Array.from(store.keys())) {
    if (/^filters:.*[:-]q$/.test(k)) store.delete(k);
  }
}

// Drops every remembered filter of every page (a sidebar click opens its page fresh).
export function clearAllPersistedFilters() {
  store.clear();
}

// Drops every remembered filter of one page (keys start with `prefix`), e.g. "requests:".
export function clearPersistedFilters(prefix: string) {
  for (const k of Array.from(store.keys())) {
    if (k.startsWith(`filters:${prefix}`)) store.delete(k);
  }
}
