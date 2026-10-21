import { apiRequestEnveloped as apiRequest, apiUrl } from "@/common/services/httpClient";
import { getToken } from "@/common/services/tokenStorage";
import { Loan } from "@/modules/loans/services/loanService";

// Wire casing differs from backend/internal/loan/model.go's PaymentType* constants (e.g. "Full Settlement").
export type RazorpayPaymentType = "Interest" | "FullSettlement" | "Partial";

export type RazorpayOrder = {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
};

export type LoanPayment = {
  id: number;
  loanId: number;
  loanNumber?: string;
  amount: number;
  type: string; // PaymentType* — "Interest" | "Partial" | "Full Settlement" | ...
  method: string; // "Online" for Razorpay payments, "Cash"/etc. for staff-recorded ones
  reference?: string;
  description?: string;
  paidOn: string;
  createdAt: string;
};

export function createOrder(
  loanId: number,
  input: { amount: number; type: RazorpayPaymentType }
): Promise<RazorpayOrder> {
  return apiRequest(`/loans/${loanId}/pay/create-order`, { method: "POST", body: input });
}

export function verifyPayment(
  loanId: number,
  input: { orderId: string; paymentId: string; signature: string; amount: number; type: RazorpayPaymentType }
): Promise<Loan> {
  return apiRequest(`/loans/${loanId}/pay/verify`, { method: "POST", body: input });
}

export function listLoanPayments(loanId: number): Promise<LoanPayment[]> {
  return apiRequest(`/loans/${loanId}/payments`);
}

export function listPayments(params: { limit: number; offset: number }): Promise<{ items: LoanPayment[]; hasMore: boolean }> {
  return apiRequest("/payments", { params });
}

// Returns a raw PDF, not JSON, so it can't go through apiRequest's JSON-only wrapper.
export async function getReceiptDownloadInfo(paymentId: number): Promise<{ url: string; headers: Record<string, string> }> {
  const token = await getToken();
  const headers: Record<string, string> = { "ngrok-skip-browser-warning": "true" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return { url: apiUrl(`/payments/${paymentId}/receipt`), headers };
}
