import { apiRequestEnveloped as apiRequest } from "./client";

// Mirrors frontend/modules/personal-loans/services/personalLoanService.ts's
// types exactly (backend/internal/personalloan's models) — an unsecured,
// no-KYC loan product separate from the Gold Loan module.
export type InterestType = "Flat" | "Percentage";
export type Frequency = "Daily" | "Weekly" | "Monthly";
export type PersonalLoanStatus = "Active" | "Pending" | "Closed" | "Renewed" | "Defaulted";

export type PersonalLoan = {
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
  penalInterestRate: number;
  penalFlatAmount: number;
  gracePeriodDays: number;
  penalCycleCount: number;
  totalPenalInterestCharged: number;
  lastPenalAppliedAt: string | null;
  createdAt: string;
};

export type PersonalLoanInstallment = {
  id: number;
  personalLoanId: number;
  sequenceNo: number;
  dueDate: string;
  amount: number;
  status: "Pending" | "Paid" | "PartiallyPaid";
  paidAmount: number;
};

export type PersonalLoanPayment = {
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

// Page-scoped list — mirrors mobile Loans' listLoansPage convention
// (0-based `offset`, {items, hasMore} envelope) rather than the web's
// 1-based `page` number.
export function listPersonalLoansPage(params: {
  q?: string;
  frequency?: Frequency;
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

export type CreatePersonalLoanInput = {
  branchId: number;
  customerId: number;
  principalAmount: number;
  interestType: InterestType;
  interestValue: number;
  frequency: Frequency;
  tenureCount: number;
  // Omit or 0 to default to the loan's own effective interest rate — see
  // backend CreateInput.PenalInterestRate's doc comment.
  penalInterestRate?: number;
  // Omit or 0 for no grace period.
  gracePeriodDays?: number;
};

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
    reference?: string;
    description?: string;
  }
) {
  return apiRequest<PersonalLoan>(`/personal-loans/${id}/payments`, { method: "POST", body: input });
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

export function previewRenewal(id: number, input: RenewInput) {
  return apiRequest<RenewalPreview>(`/personal-loans/${id}/renewal-preview`, { method: "POST", body: input });
}

export type RenewResult = { oldLoan: PersonalLoan; newLoan: PersonalLoan };

export function renewPersonalLoan(id: number, input: RenewInput) {
  return apiRequest<RenewResult>(`/personal-loans/${id}/renew`, { method: "POST", body: input });
}
