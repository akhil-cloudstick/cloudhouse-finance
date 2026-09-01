import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";

export type InterestType = "Flat" | "Percentage";
export type Frequency = "Daily" | "Weekly" | "Monthly";
export type PersonalLoanStatus = "Active" | "Closed" | "Renewed" | "Defaulted";

/* Mirrors backend/internal/personalloan/handler.go's createRequest exactly. */
export type CreatePersonalLoanInput = {
  branchId: number;
  customerId: number;
  principalAmount: number;
  interestType: InterestType;
  interestValue: number;
  frequency: Frequency;
  tenureCount: number;
};

/* Mirrors backend/internal/personalloan/model_loan.go's PersonalLoan
 * exactly (only the fields the frontend needs). */
export type BackendPersonalLoan = {
  id: number;
  loanNumber: string;
  branchId: number;
  customerId: number;
  customer: { id: number; name: string; code: string; phone: string };
  principalAmount: number;
  interestType: InterestType;
  interestValue: number;
  interestAmount: number;
  disbursedAmount: number;
  frequency: Frequency;
  tenureCount: number;
  installmentAmount: number;
  outstandingAmount: number;
  totalPaid: number;
  status: PersonalLoanStatus;
  openedDate: string;
  disbursedAt: string;
  closedAt: string | null;
  renewedFromLoanId: number | null;
  renewedToLoanId: number | null;
  createdAt: string;
};

/* Mirrors backend/internal/personalloan/model_installment.go's
 * PersonalLoanInstallment exactly. */
export type BackendPersonalLoanInstallment = {
  id: number;
  personalLoanId: number;
  sequenceNo: number;
  dueDate: string;
  amount: number;
  status: "Pending" | "Paid" | "PartiallyPaid";
  paidAmount: number;
};

/* Mirrors backend/internal/personalloan/model_payment.go's
 * PersonalLoanPayment exactly. */
export type BackendPersonalLoanPayment = {
  id: number;
  personalLoanId: number;
  amount: number;
  paidOn: string;
  receivedByEmployeeId: number | null;
  method: string;
  reference: string;
  description: string;
  runningBalance: number;
  installmentId: number | null;
  createdAt: string;
};

export function createPersonalLoan(input: CreatePersonalLoanInput): Promise<BackendPersonalLoan> {
  return apiFetch<BackendPersonalLoan>("/personal-loans", { method: "POST", body: JSON.stringify(input) });
}

export function listPersonalLoans(params?: { customerId?: number; status?: string }): Promise<BackendPersonalLoan[]> {
  const q = new URLSearchParams();
  if (params?.customerId) q.set("customerId", String(params.customerId));
  if (params?.status) q.set("status", params.status);
  const qs = q.toString();
  return apiFetch<BackendPersonalLoan[]>(`/personal-loans${qs ? `?${qs}` : ""}`);
}

export function getPersonalLoan(id: number): Promise<BackendPersonalLoan> {
  return apiFetch<BackendPersonalLoan>(`/personal-loans/${id}`);
}

export function getPersonalLoanSchedule(id: number): Promise<BackendPersonalLoanInstallment[]> {
  return apiFetch<BackendPersonalLoanInstallment[]>(`/personal-loans/${id}/schedule`);
}

export function listPersonalLoanPayments(id: number): Promise<BackendPersonalLoanPayment[]> {
  return apiFetch<BackendPersonalLoanPayment[]>(`/personal-loans/${id}/payments`);
}

export function recordPersonalLoanPayment(
  id: number,
  input: { amount: number; method: string; reference?: string; description?: string }
): Promise<BackendPersonalLoan> {
  return apiFetch<BackendPersonalLoan>(`/personal-loans/${id}/payments`, { method: "POST", body: JSON.stringify(input) });
}

export type RenewInput = {
  principalAmount: number;
  interestType: InterestType;
  interestValue: number;
  frequency: Frequency;
  tenureCount: number;
};

export type RenewalPreview = {
  rollover: number;
  interestAmount: number;
  disbursedAmount: number;
  shortfall: boolean;
};

export function previewRenewal(id: number, input: RenewInput): Promise<RenewalPreview> {
  return apiFetch<RenewalPreview>(`/personal-loans/${id}/renewal-preview`, { method: "POST", body: JSON.stringify(input) });
}

export type RenewResult = { oldLoan: BackendPersonalLoan; newLoan: BackendPersonalLoan };

export function renewPersonalLoan(id: number, input: RenewInput): Promise<RenewResult> {
  return apiFetch<RenewResult>(`/personal-loans/${id}/renew`, { method: "POST", body: JSON.stringify(input) });
}

export function listPersonalLoansForCustomer(customerId: number): Promise<BackendPersonalLoan[]> {
  return apiFetch<BackendPersonalLoan[]>(`/customers/${customerId}/personal-loans`);
}
