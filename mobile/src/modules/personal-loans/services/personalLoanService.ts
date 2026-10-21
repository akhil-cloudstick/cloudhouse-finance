import { apiRequestEnveloped as apiRequest, API_BASE_URL, apiUrl } from "@/common/services/httpClient";
import type { Frequency, PersonalLoan, PersonalLoanInstallment, PersonalLoanPayment, CreatePersonalLoanInput, RenewInput, RenewalPreview, RenewResult, PersonalLoanApproval, PersonalLoanBondLang } from "@/modules/personal-loans/types/personal-loan-types";

export function listPersonalLoansPage(params: {
  q?: string;
  frequency?: string;
  status?: string;
  customerId?: number;
  limit: number;
  offset: number;
}) {
  return apiRequest<{ items: PersonalLoan[]; hasMore: boolean }>("/personal-loans", { params });
}

export function getPersonalLoan(id: number) {
  return apiRequest<PersonalLoan>(`/personal-loans/${id}`);
}

export function getPersonalLoanSchedulePage(id: number, limit: number, offset: number) {
  return apiRequest<{ items: PersonalLoanInstallment[]; hasMore: boolean }>(`/personal-loans/${id}/schedule`, {
    params: { limit, offset },
  });
}

export function listPersonalLoanPaymentsPage(id: number, limit: number, offset: number) {
  return apiRequest<{ items: PersonalLoanPayment[]; hasMore: boolean }>(`/personal-loans/${id}/payments`, {
    params: { limit, offset },
  });
}

export function createPersonalLoan(input: CreatePersonalLoanInput) {
  return apiRequest<PersonalLoan>("/personal-loans", { method: "POST", body: input });
}

export function recordPersonalLoanPayment(
  id: number,
  input: {
    amount: number;
    cashAmount: number; // must sum to amount
    upiAmount: number;
    bankTransferAmount: number;
    chequeAmount: number;
    // Required when any of UPI/Bank Transfer/Cheque is non-zero.
    bankId?: number;
    reference?: string;
    description?: string;
  }
) {
  return apiRequest<PersonalLoan>(`/personal-loans/${id}/payments`, { method: "POST", body: input });
}

export function previewRenewal(id: number, input: RenewInput) {
  return apiRequest<RenewalPreview>(`/personal-loans/${id}/renewal-preview`, { method: "POST", body: input });
}

export function renewPersonalLoan(id: number, input: RenewInput) {
  return apiRequest<RenewResult>(`/personal-loans/${id}/renew`, { method: "POST", body: input });
}

export function approvePersonalLoan(id: number, input: { stage: string; action: "Approved" | "Rejected"; remarks?: string }) {
  return apiRequest<PersonalLoan>(`/personal-loans/${id}/approve`, { method: "POST", body: input });
}

export function listPersonalLoanApprovals(id: number) {
  return apiRequest<PersonalLoanApproval[]>(`/personal-loans/${id}/approvals`);
}

export function personalLoanBondUrl(loanId: number | string, lang: PersonalLoanBondLang): string {
  return apiUrl(`/personal-loans/${loanId}/bond?lang=${lang}`);
}
