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
    reference?: string;
    description?: string;
  }
) {
  return apiRequest<Loan>(`/loans/${loanId}/payments`, { method: "POST", body: input });
}
