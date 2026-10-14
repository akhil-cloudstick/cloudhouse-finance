import { apiRequestEnveloped as apiRequest, API_BASE_URL, apiUrl } from "@/common/services/httpClient";
import type { Frequency, PersonalLoan, PersonalLoanInstallment, PersonalLoanPayment, CreatePersonalLoanInput, RenewInput, RenewalPreview, RenewResult, PersonalLoanApproval, PersonalLoanBondLang } from "@/modules/personal-loans/types/personal-loan-types";

// Page-scoped list — mirrors mobile Loans' listLoansPage convention
// (0-based `offset`, {items, hasMore} envelope) rather than the web's
// 1-based `page` number.
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
    // Backend requires these to sum to amount (platform.ValidateSplit).
    cashAmount: number;
    upiAmount: number;
    bankTransferAmount: number;
    chequeAmount: number;
    // Which bank the UPI/Bank Transfer/Cheque portion landed in — required
    // when any of those three is non-zero (see backend's
    // ErrBankRequiredForSplitMode).
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

// Stage decision on a "Pending Approval" personal loan — the final stage's
// approval disburses it and builds its schedule.
export function approvePersonalLoan(id: number, input: { stage: string; action: "Approved" | "Rejected"; remarks?: string }) {
  return apiRequest<PersonalLoan>(`/personal-loans/${id}/approve`, { method: "POST", body: input });
}

export function listPersonalLoanApprovals(id: number) {
  return apiRequest<PersonalLoanApproval[]>(`/personal-loans/${id}/approvals`);
}

// The bond PDF, downloaded straight to a file (expo-file-system) rather than through apiRequest.
export function personalLoanBondUrl(loanId: number | string, lang: PersonalLoanBondLang): string {
  return apiUrl(`/personal-loans/${loanId}/bond?lang=${lang}`);
}
