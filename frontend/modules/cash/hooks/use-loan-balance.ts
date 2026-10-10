"use client";

import { useEffect, useState } from "react";
import { getLoanBalance, isLoanSource } from "@/modules/cash/services/cashSourceService";
import { type LoanBalance } from "@/modules/cash/types/cash-source-types";

/* The current balance of the loan a category row stands for — null while it
 * loads, or when the category isn't a loan with its details on file (a new
 * loan has nothing drawn yet, so there is nothing to check against). Used by
 * the Add Entry forms to block an amount the loan can't take. */
export function useLoanBalance(cat: { id: number; name: string; principalAmount?: number } | null): LoanBalance | null {
  const [balance, setBalance] = useState<LoanBalance | null>(null);
  const id = cat && cat.id > 0 && isLoanSource(cat.name) && cat.principalAmount != null ? cat.id : 0;
  useEffect(() => {
    let cancelled = false;
    setBalance(null);
    if (id) getLoanBalance(id).then((b) => { if (!cancelled) setBalance(b); }).catch(() => {});
    return () => { cancelled = true; };
  }, [id]);
  return balance;
}
