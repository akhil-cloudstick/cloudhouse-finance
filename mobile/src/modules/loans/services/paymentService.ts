import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import { Loan } from "@/modules/loans/types/loan-types";

// paidOn is YYYY-MM-DD; the actor is derived server-side from the JWT, never sent from here.
export function recordPayment(
  loanId: number,
  input: {
    amount: number;
    type: string; // "Interest" | "Principal" | "Partial" | "Full Settlement" | "Adjustment" | "Waiver"
    processingFee?: number;
    paidOn: string;
    method?: string;
    // Per-mode split; must sum to amount when sent.
    cashAmount?: number;
    upiAmount?: number;
    bankTransferAmount?: number;
    chequeAmount?: number;
    // Required when UPI/Bank Transfer/Cheque is non-zero.
    bankId?: number;
    reference?: string;
    description?: string;
    // Overrides the system-calculated interest bucket for this payment only; omit to use the live figure.
    interestOverride?: number;
  }
) {
  return apiRequest<Loan>(`/loans/${loanId}/payments`, { method: "POST", body: input });
}
