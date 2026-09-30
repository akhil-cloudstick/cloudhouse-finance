import { apiRequestEnveloped as apiRequest } from "./client";
import { Loan } from "../types/loan";

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
  }
) {
  return apiRequest<Loan>(`/loans/${loanId}/payments`, { method: "POST", body: input });
}
