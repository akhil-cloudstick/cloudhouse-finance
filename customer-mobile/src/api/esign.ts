import { apiRequestEnveloped as apiRequest } from "./client";
import { Loan } from "./loans";

// Backs GET /customer/loans/:id/indemnity-bond/esign/status
// (backend/internal/loan/customer_handler.go's CustomerCheckIndemnityBondEsign).
// Deliberately read-only: the signing URL only ever reaches this app via a
// staff-started deliverBy=dashboard/whatsapp send (see loan.Service.
// StartIndemnityBondSign) — there is no customer-facing "start" call, this
// only polls whatever eSign request staff already started, the same way
// checkAadhaarVerify() polls a DigiLocker request staff never touch.
export type IndemnityBondEsignCheck = {
  loan: Loan;
  status: string;
};

export function checkIndemnityBondEsign(loanId: number) {
  return apiRequest<IndemnityBondEsignCheck>(`/customer/loans/${loanId}/indemnity-bond/esign/status`);
}
