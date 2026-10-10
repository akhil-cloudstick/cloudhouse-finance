"use client";

import { useEffect, useState } from "react";
import { getCashSummary } from "@/modules/cash/services/cashService";

/* The branch's current Balance in Hand (cash.SummaryService's expectedCash),
 * or null while loading / when unknown. Payouts larger than this are refused
 * server-side (cash.SummaryService.EnsureCashInHand); this only lets a modal
 * warn before submitting. */
export function useBalanceInHand(branchId?: number): number | null {
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    setBalance(null);
    if (!branchId) return;
    let cancelled = false;
    getCashSummary(branchId)
      .then((s) => { if (!cancelled) setBalance(s.expectedCash); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [branchId]);
  return balance;
}
