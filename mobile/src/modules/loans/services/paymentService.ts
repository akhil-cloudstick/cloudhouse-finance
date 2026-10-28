import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import { Loan } from "@/modules/loans/types/loan-types";

// Backs POST /loans/:id/payments (backend/internal/loan/handler.go's
// RecordPayment/paymentRequest). paidOn is YYYY-MM-DD; the actor
// (receivedByEmployeeId) is derived server-side from the JWT, never sent
// from here.
export function recordPayment(
  loanId: number,
  input: {
    amount: number;
    type: string; // "Interest" | "Principal" | "Partial" | "Full Settlement" | "Adjustment" | "Waiver"
    processingFee?: number;
    paidOn: string;
    method?: string;
    // Per-mode split; must sum to amount when sent (platform.ValidateSplit).
    cashAmount?: number;
    upiAmount?: number;
    bankTransferAmount?: number;
    chequeAmount?: number;
    // Which bank the UPI/Bank Transfer/Cheque portion landed in — required
    // when any of those three is non-zero (see backend's
    // ErrBankRequiredForSplitMode).
    bankId?: number;
    reference?: string;
    description?: string;
    // Overrides the system-calculated interest bucket for this payment
    // only (see backend's PaymentInput.InterestOverride doc comment) —
    // omit to use the live-calculated figure.
    interestOverride?: number;
    // A write-off taken off the loan on the same date: `amount` stays what the
    // customer actually pays. Needs a reason and the mode it is shown under.
    discount?: number;
    discountReason?: string;
    discountKind?: "customer" | "interest" | "penal_interest"; // what a discount is given against
    discountMode?: string; // Cash | UPI | Bank Transfer | Cheque
  }
) {
  return apiRequest<Loan>(`/loans/${loanId}/payments`, { method: "POST", body: input });
}

/* --- Ledger edit / delete -------------------------------------------------
 * Editing or deleting a payment or discount recalculates the whole loan on the
 * server (interest, later payments, balances, status, cash lines) in one
 * transaction. dryRun asks for the before/after figures without saving. */
export type LedgerLoanSummary = { principal: number; interest: number; penalInterest: number; fee: number; total: number; status: string };
/** Offered when a repayment edit reopens a closed loan: the packet can go back to the status it had before. */
export type PacketReversalOffer = { packetId: number; code: string; currentStatus: string; previousStatus: string; lockerId?: number };
export type LedgerEditPreview = {
  before: LedgerLoanSummary; after: LedgerLoanSummary; dryRun: boolean;
  packet?: PacketReversalOffer; packetReversed?: boolean; packetError?: string;
};

export function editLedgerPayment(
  loanId: number,
  paymentId: number,
  input: {
    paidOn?: string;
    amount?: number;
    type?: string;
    cashAmount?: number;
    upiAmount?: number;
    bankTransferAmount?: number;
    chequeAmount?: number;
    bankId?: number; // required when the breakdown has a UPI / Bank Transfer part
    reference?: string;
    discountReason?: string; // Discount rows only
    discountKind?: "customer" | "interest" | "penal_interest"; // what a discount is given against
    discountMode?: string; // Discount rows only
    reason?: string;
    reversePacket?: boolean; // also put the packet back to its previous status (see PacketReversalOffer)
  },
  dryRun = false
) {
  return apiRequest<LedgerEditPreview>(`/loans/${loanId}/payments/${paymentId}${dryRun ? "?dry_run=true" : ""}`, { method: "PATCH", body: input });
}

export function deleteLedgerPayment(loanId: number, paymentId: number, dryRun = false, reason?: string, reversePacket = false) {
  return apiRequest<LedgerEditPreview>(`/loans/${loanId}/payments/${paymentId}?${new URLSearchParams({ ...(reason ? { reason } : {}), ...(dryRun ? { dry_run: "true" } : {}), ...(reversePacket ? { reverse_packet: "true" } : {}) })}`, { method: "DELETE" });
}

/* --- Top-up edit / delete — same two-step preview / confirm as a payment edit. */
export function editLoanTopUp(
  loanId: number,
  topUpId: number,
  input: {
    occurredOn?: string;
    amount?: number;
    cashAmount?: number;
    upiAmount?: number;
    bankTransferAmount?: number;
    bankId?: number;
    reference?: string;
    reason?: string;
  },
  dryRun = false
) {
  return apiRequest<LedgerEditPreview>(`/loans/${loanId}/top-ups/${topUpId}${dryRun ? "?dry_run=true" : ""}`, { method: "PATCH", body: input });
}

export function deleteLoanTopUp(loanId: number, topUpId: number, dryRun = false, reason?: string) {
  return apiRequest<LedgerEditPreview>(`/loans/${loanId}/top-ups/${topUpId}?${new URLSearchParams({ ...(reason ? { reason } : {}), ...(dryRun ? { dry_run: "true" } : {}) })}`, { method: "DELETE" });
}
