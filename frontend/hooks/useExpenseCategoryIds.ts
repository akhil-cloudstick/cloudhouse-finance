"use client";

import { useEffect, useState } from "react";
import { searchExpenseCategoriesPage } from "@/modules/cash/services/expenseCategoryService";

/* Lower-cased category name -> id. Expense.category is free text server
 * side, so ledger rows only carry the name; this resolves it to the id the
 * category ledger route (#party-category/:id) needs. Loaded once per mount. */
export function useExpenseCategoryIds(): Record<string, number> {
  const [map, setMap] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, number> = {};
      for (let page = 0; ; page++) {
        const res = await searchExpenseCategoriesPage("", page);
        for (const c of res.items) next[c.name.toLowerCase()] = c.id;
        if (!res.hasMore || cancelled) break;
      }
      if (!cancelled) setMap(next);
    })().catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return map;
}

const EXPENSE_PREFIX = "Expense — ";

/* The category name inside an approved expense's ledger text ("Expense —
 * Rent", see cash.MovementService.RecordExpenseCashOut), or null. */
export function expenseCategoryOf(text?: string): string | null {
  return text && text.startsWith(EXPENSE_PREFIX) ? text.slice(EXPENSE_PREFIX.length).trim() : null;
}
