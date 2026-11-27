import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import { Loan } from "@/modules/loans/services/loanService";

// Read-only: only polls an eSign request staff already started; there is no customer-facing "start" call.
export type IndemnityBondEsignCheck = {
  loan: Loan;
  status: string;
};

export function checkIndemnityBondEsign(loanId: number) {
  return apiRequest<IndemnityBondEsignCheck>(`/loans/${loanId}/indemnity-bond/esign/status`);
}
