
import type { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/common/services/httpClient";

// Shared bits for the loan-detail sheets (app/(tabs)/loans/[id].tsx).

export function apiErr(err: unknown, fallback = "Could not complete that action.") {
  return err instanceof ApiError ? err.message : fallback;
}

// Everything a change on one loan can affect — loan, auction, approvals, requests, bank pledge, packet, lists.
export function invalidateLoan(qc: QueryClient, loanId: number | string) {
  const id = String(loanId);
  qc.invalidateQueries({ queryKey: ["loan", id] });
  qc.invalidateQueries({ queryKey: ["auction", id] });
  qc.invalidateQueries({ queryKey: ["loanApprovals", id] });
  qc.invalidateQueries({ queryKey: ["loanRequests"] });
  qc.invalidateQueries({ queryKey: ["bankPledgeHistory", id] });
  qc.invalidateQueries({ queryKey: ["loanPacket", id] });
  qc.invalidateQueries({ queryKey: ["loanTopUps", id] });
  qc.invalidateQueries({ queryKey: ["loans"] });
}

// Auction Sale/Write-Off are system-generated only, never staff-entered here; same order/wording as web's list.
export const PAYMENT_TYPES = ["Partial", "Interest", "Penal Interest", "Principal", "Full Settlement"] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];
export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  Partial: "Both — interest, then principal",
  Interest: "Interest only",
  "Penal Interest": "Penal interest only",
  Principal: "Principal only",
  "Full Settlement": "Full settlement — close the loan",
};
