import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import { Loan, BankPledgeRecord } from "@/modules/loans/types/loan-types";
import type { BankPledgeHistoryRow, Page } from "@/modules/bank-pledges/types/bank-pledge-types";

// Backs POST /loans/:id/bank-pledge (backend/internal/loan/handler.go's
// RecordBankPledge/bankPledgeRequest). pledgeDate/bankPledgeDueDate are
// YYYY-MM-DD. cashTreatment omitted defaults server-side to "RecordOnly"
// (no cash effect) — see handler.go:761-767.
export function recordBankPledge(
  loanId: number,
  input: {
    bankId?: number;
    bankName: string;
    pledgedAmount: number;
    pledgeDate: string;
    bankInterestRate?: number;
    referenceNumber?: string;
    bankPledgeDueDate?: string;
    cashTreatment?: "CashIn" | "RecordOnly";
  }
) {
  return apiRequest<BankPledgeRecord>(`/loans/${loanId}/bank-pledge`, { method: "POST", body: input });
}

// Releases the gold from the bank (PUT /loans/:id/bank-pledge/:pledgeId/release).
// If the pledge's cashTreatment was "CashIn", the pledged amount is booked
// back out of Cash-in-Hand server-side.
export function releaseBankPledge(loanId: number, pledgeId: number) {
  return apiRequest<BankPledgeRecord>(`/loans/${loanId}/bank-pledge/${pledgeId}/release`, { method: "PUT" });
}

// Voids a mis-recorded pledge — restricted server-side to Administrator/
// Management/Branch Manager (see routes.go:69-71). reason is required.
export function voidBankPledge(loanId: number, pledgeId: number, reason: string) {
  return apiRequest<BankPledgeRecord>(`/loans/${loanId}/bank-pledge/${pledgeId}/void`, {
    method: "PUT",
    body: { reason },
  });
}

export function getBankPledgeHistory(loanId: number) {
  return apiRequest<BankPledgeRecord[]>(`/loans/${loanId}/bank-pledge/history`);
}

// Loans currently re-pledged with a bank — the Bank Pledge screen's Active
// tab. Each loan carries its bankPledges[] preloaded; the Active one is the
// pledge to release.
export async function listBankPledgedLoansPage(params: { q?: string; limit: number; offset: number }) {
  const res = await apiRequest<Page<Loan>>("/loans", {
    params: { bankPledgeStatus: "Bank Pledged", ...params },
  });
  return { items: res.items ?? [], hasMore: res.hasMore, total: res.total ?? 0 };
}

// Every pledge ever recorded across all loans (Active, Released, Voided).
export async function listBankPledgeHistoryPage(params: { q?: string; limit: number; offset: number }) {
  const res = await apiRequest<Page<BankPledgeHistoryRow>>("/loans/bank-pledges/history", { params });
  return { items: res.items ?? [], hasMore: res.hasMore, total: res.total ?? 0 };
}
