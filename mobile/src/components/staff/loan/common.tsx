import React from "react";
import type { QueryClient } from "@tanstack/react-query";
import { C, Txt } from "../../ui";
import { ApiError } from "../../../api/client";

// Shared bits for the loan-detail sheets (app/(tabs)/loans/[id].tsx).

export function apiErr(err: unknown, fallback = "Could not complete that action.") {
  return err instanceof ApiError ? err.message : fallback;
}

/** Red error line shown just above a sheet's confirm button. */
export function ErrorText({ children }: { children?: string | null }) {
  if (!children) return null;
  return <Txt style={{ color: C.red, fontSize: 12, fontWeight: "600", marginBottom: 10 }}>{children}</Txt>;
}

/** Everything a change on one loan can affect — the loan itself, its auction
 * case, approvals, requests (prefix also refreshes the Requests list), bank
 * pledge history and packet, plus the paged Loans list / dashboard. */
export function invalidateLoan(qc: QueryClient, loanId: number | string) {
  const id = String(loanId);
  qc.invalidateQueries({ queryKey: ["loan", id] });
  qc.invalidateQueries({ queryKey: ["auction", id] });
  qc.invalidateQueries({ queryKey: ["loanApprovals", id] });
  qc.invalidateQueries({ queryKey: ["loanRequests"] });
  qc.invalidateQueries({ queryKey: ["bankPledgeHistory", id] });
  qc.invalidateQueries({ queryKey: ["loanPacket", id] });
  qc.invalidateQueries({ queryKey: ["loans"] });
}

// Payment types accepted by backend/internal/loan/model.go's PaymentType*
// constants — Auction Sale/Write-Off are system-generated only, never
// staff-entered here (mirrors frontend/components/modals/PaymentModal.tsx).
export const PAYMENT_TYPES = ["Interest", "Principal", "Partial", "Full Settlement", "Adjustment", "Waiver"] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];
