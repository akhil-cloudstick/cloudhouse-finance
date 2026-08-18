import { apiRequest } from "./client";
import { API_BASE_URL } from "./config";
import { getToken } from "../auth/tokenStorage";
import { Loan } from "./loans";

// The payment `type` sent to POST /:id/pay/create-order and .../pay/verify —
// matches the literal wire casing from the plan's Batch 3 spec (the handler
// maps these onto backend/internal/loan/model.go's PaymentType* constants,
// which use different casing, e.g. "Full Settlement").
export type RazorpayPaymentType = "Interest" | "FullSettlement" | "Partial";

// Response of POST /customer/loans/:id/pay/create-order.
export type RazorpayOrder = {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
};

// Mirrors the subset of backend/internal/loan/model.go's LoanPayment JSON
// shape the customer app needs (payment history rows + receipts).
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

// POST /customer/loans/:id/pay/create-order.
export function createOrder(
  loanId: number,
  input: { amount: number; type: RazorpayPaymentType }
): Promise<RazorpayOrder> {
  return apiRequest(`/loans/${loanId}/pay/create-order`, { method: "POST", body: input });
}

// POST /customer/loans/:id/pay/verify — returns the updated Loan (outstanding
// figures reflect the just-recorded payment via the existing allocation
// waterfall).
export function verifyPayment(
  loanId: number,
  input: { orderId: string; paymentId: string; signature: string; amount: number; type: RazorpayPaymentType }
): Promise<Loan> {
  return apiRequest(`/loans/${loanId}/pay/verify`, { method: "POST", body: input });
}

// GET /customer/loans/:id/payments — one loan's payment history, newest
// first, for Loan Detail's Payment History section.
export function listLoanPayments(loanId: number): Promise<LoanPayment[]> {
  return apiRequest(`/loans/${loanId}/payments`);
}

// GET /customer/payments?limit=&offset= — paginated across all the
// customer's loans, newest first, for the Payments tab's global history.
export function listPayments(params: { limit: number; offset: number }): Promise<{ items: LoanPayment[]; hasMore: boolean }> {
  return apiRequest("/payments", { params });
}

// GET /customer/payments/:paymentId/receipt returns a raw PDF, not JSON, so
// it can't go through apiRequest's JSON-only wrapper. Callers (the 🖶
// receipt button) use expo-file-system's downloadAsync with this URL +
// header directly to a local file, then hand that file to expo-print /
// expo-sharing — no base64 round-trip needed.
export async function getReceiptDownloadInfo(paymentId: number): Promise<{ url: string; headers: Record<string, string> }> {
  const token = await getToken();
  const headers: Record<string, string> = { "ngrok-skip-browser-warning": "true" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return { url: `${API_BASE_URL}/payments/${paymentId}/receipt`, headers };
}
