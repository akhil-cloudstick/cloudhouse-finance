"use client";

import { useEffect, useState } from "react";
import { searchExpenseCategoriesPage, EXPENSE_CATEGORIES_CHANGED } from "@/modules/cash/services/expenseCategoryService";
import { searchCashSourcesPage } from "@/modules/cash/services/cashSourceService";

// Lower-cased category name -> the bank loan number captured when that loan
// source was first used in Add Cash. Filled as a side effect of the load below.
const loanNumberByCategory: Record<string, string> = {};
export function loanNumberOfCategory(name: string): string {
  return loanNumberByCategory[name.trim().toLowerCase()] || "";
}

/* Lower-cased category name (expense categories and cash sources) -> id. Expense.category is free text server
 * side, so ledger rows only carry the name; this resolves it to the id the
 * category ledger route (/ledger-category/:id) needs. Loaded on mount and
 * again whenever a category is created. */
export function useExpenseCategoryIds(): Record<string, number> {
  return useExpenseCategoryIdsState().ids;
}

// The last loaded map, kept for the session so a ledger that mounts again starts with its links already resolved.
let cachedIds: Record<string, number> | null = null;

/* Same map plus whether it has loaded — a ledger holds its rows until `ready`, so a reference
 * is never painted as plain text and then swapped for a link. */
export function useExpenseCategoryIdsState(): { ids: Record<string, number>; ready: boolean } {
  const [map, setMap] = useState<Record<string, number>>(cachedIds ?? {});
  const [ready, setReady] = useState(cachedIds !== null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(EXPENSE_CATEGORIES_CHANGED, bump);
    return () => window.removeEventListener(EXPENSE_CATEGORIES_CHANGED, bump);
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, number> = {};
      // Expense categories and cash sources are one table now, so an id from
      // either list opens the same category ledger.
      for (const search of [searchExpenseCategoriesPage, searchCashSourcesPage]) {
        for (let page = 0; ; page++) {
          const res = await search("", page);
          for (const c of res.items) {
            next[c.name.toLowerCase()] = c.id;
            const loanNumber = (c as { loanNumber?: string }).loanNumber;
            if (loanNumber) loanNumberByCategory[c.name.toLowerCase()] = loanNumber;
          }
          if (!res.hasMore || cancelled) break;
        }
      }
      if (!cancelled) { cachedIds = next; setMap(next); setReady(true); }
    })().catch(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [version]);
  return { ids: map, ready };
}

const EXPENSE_PREFIX = "Expense — ";

/* The category name inside an approved expense's ledger text ("Expense —
 * Rent", see cash.MovementService.RecordExpenseCashOut), or null. */
export function expenseCategoryOf(text?: string): string | null {
  return text && text.startsWith(EXPENSE_PREFIX) ? text.slice(EXPENSE_PREFIX.length).trim() : null;
}
