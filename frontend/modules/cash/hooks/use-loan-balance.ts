"use client";

import { useEffect, useState } from "react";
import { getLoanBalance, isLoanSource } from "@/modules/cash/services/cashSourceService";
import { type LoanBalance } from "@/modules/cash/types/cash-source-types";

// null while loading, or when the category isn't a loan with details on file.
export function useLoanBalance(cat: { id: number; name: string; principalAmount?: number } | null): LoanBalance | null {
  const [balance, setBalance] = useState<LoanBalance | null>(null);
  const id = cat && cat.id > 0 && isLoanSource(cat.name) ? cat.id : 0;
  useEffect(() => {
    let cancelled = false;
    setBalance(null);
    if (id) getLoanBalance(id).then((b) => { if (!cancelled) setBalance(b); }).catch(() => {});
    return () => { cancelled = true; };
  }, [id]);
  return balance;
}
