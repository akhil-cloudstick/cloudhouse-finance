"use client";

import { useEffect, useState } from "react";
import { getCashSummary } from "@/modules/cash/services/cashService";
import { useAuth } from "@/common/providers/AuthProvider";

/* The branch's current Balance in Hand (cash.SummaryService's expectedCash),
 * or null while loading / when unknown. Payouts larger than this are refused
 * server-side (cash.SummaryService.EnsureCashInHand); this only lets a modal
 * warn before submitting. Stays null without "can view cash module" — the
 * summary would only 403, and the server-side check still applies. */
export function useBalanceInHand(branchId?: number): number | null {
  const canViewCash = useAuth().can("Cash_Management", "can_view_cash_module");
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    setBalance(null);
    if (!branchId || !canViewCash) return;
    let cancelled = false;
    getCashSummary(branchId)
      .then((s) => { if (!cancelled) setBalance(s.expectedCash); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [branchId, canViewCash]);
  return balance;
}
