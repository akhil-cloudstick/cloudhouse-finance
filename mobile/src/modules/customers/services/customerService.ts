import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import { Customer, type CustomerInput } from "@/modules/customers/types/customer-types";
import { CustomerOrnamentRow, CustomerPaymentRow, CustomerBankPledgeRow, CustomerAuctionRow } from "@/modules/loans/types/loan-types";

// `q` (server-side search) mirrors backend/internal/customer/handler.go's
// List — never fetch all customers and filter with .includes() on-device.
//
// Deliberately omits `limit`: passing it flips the backend into its
// paginated {items, hasMore} envelope (handler.go's List, used by the web
// SearchableSelect) instead of the bare Customer[] array this screen
// expects — that mismatch was silently emptying the mobile Customers list.
export function listCustomers(q?: string) {
  return apiRequest<Customer[]>("/customers", { params: { q } });
}

// Page-scoped variant: passing `limit` flips the backend (customer/handler.go's
// List) into the {items, hasMore} envelope — used by the paginated mobile
// Customers list (10/page, one API call per page). branchIds narrows to
// customers whose home branch is one of these (a customer belongs to
// exactly one branch — see customer.model.go) — used by the Cash Movements
// filter's Branch→Customer narrowing (mirrors web's listCustomersPage).
export function listCustomersPage(params: { q?: string; limit: number; offset: number; branchIds?: number[]; panStatus?: string; aadhaarStatus?: string }) {
  const { branchIds, ...rest } = params;
  return apiRequest<{ items: Customer[]; hasMore: boolean; total?: number }>("/customers", {
    params: { ...rest, branchIds: branchIds?.length ? branchIds.join(",") : undefined },
  });
}

export function getCustomer(id: number) {
  return apiRequest<Customer>(`/customers/${id}`);
}

// Full, decrypted Aadhaar number (GET /customers/:id/aadhaar-full) — the
// one endpoint that ever returns more than AadhaarLast4. Used solely to
// prefill the printable pledge agreement — see src/modules/loans/utils/loanPrint.ts.
export function getCustomerAadhaarFull(id: number) {
  return apiRequest<{ aadhaar: string }>(`/customers/${id}/aadhaar-full`);
}

// --- Customer-profile sub-tabs (backend/internal/loan/handler.go's
// ListOrnamentsForCustomer/ListPaymentsForCustomer/ListBankPledgesForCustomer/
// ListAuctionHistoryForCustomer) — mirrors frontend/modules/customers/
// src/modules/customers/services/customerService.ts's listCustomer*Page functions, but in this
// app's {items,hasMore}+limit/offset convention (useInfiniteQuery, see
// src/modules/loans/pages/LoansScreen.tsx) rather than the web's 1-based page-number pager. Loan
// History itself isn't here — it's already covered by
// src/modules/loans/services/loanService.ts's listLoansPage({customerId}).
// `q` is the per-tab server search (loan no. / ornament / bank …).
function customerSubTable<T>(path: string, customerId: number, limit: number, offset: number, q?: string) {
  return apiRequest<{ items: T[]; hasMore: boolean; total?: number }>(`/customers/${customerId}/${path}`, {
    params: { limit, offset, q: q || undefined },
  });
}

export function listCustomerOrnamentsPage(customerId: number, limit: number, offset: number, q?: string) {
  return customerSubTable<CustomerOrnamentRow>("ornaments", customerId, limit, offset, q);
}
export function listCustomerPaymentsPage(customerId: number, limit: number, offset: number, q?: string) {
  return customerSubTable<CustomerPaymentRow>("payments", customerId, limit, offset, q);
}
export function listCustomerBankPledgesPage(customerId: number, limit: number, offset: number, q?: string) {
  return customerSubTable<CustomerBankPledgeRow>("bank-pledges", customerId, limit, offset, q);
}
export function listCustomerAuctionHistoryPage(customerId: number, limit: number, offset: number, q?: string) {
  return customerSubTable<CustomerAuctionRow>("auction-history", customerId, limit, offset, q);
}

export function createCustomer(input: CustomerInput) {
  return apiRequest<Customer>("/customers", { method: "POST", body: input });
}

// Same shape as createCustomer's body — backend/internal/customer/handler.go's
// Update does a full-replace PUT with the same customerRequest struct as
// Create, so the edit screen re-sends every field, not a partial patch.
// Leaving `aadhaar` empty keeps the on-file Aadhaar untouched (service.go's
// Update only re-encrypts when non-empty); leaving a document URL as the
// customer's existing value (rather than "") keeps that document instead of
// wiping it, since the backend has no notion of "unchanged" vs "cleared".
export function updateCustomer(id: number, input: CustomerInput) {
  return apiRequest<Customer>(`/customers/${id}`, { method: "PUT", body: input });
}

// PAN verification through the KYC provider (POST /customers/:id/verify-pan) — the customer comes back
// with its new PAN status, plus the name the provider matched and a message to show.
export function verifyCustomerPan(id: number) {
  return apiRequest<{ customer: Customer; message: string; matchedName: string; traceId: string }>(`/customers/${id}/verify-pan`, { method: "POST" });
}

// Permanently deletes the customer and every record tied to them. Refused while any of their loans is
// not yet Closed / Auctioned — the error message names the offending loan numbers.
export function hardDeleteCustomer(id: number) {
  return apiRequest<void>(`/customers/${id}/hard-delete`, { method: "DELETE" });
}

// A customer's overall loan totals — the figures web's "Overall Loan Details" shows (GET /customers/:id/profile360).
export function getCustomerLoanTotals(id: number) {
  return apiRequest<{ totalDisbursed: number; totalOutstanding: number; totalPaid: number; activeLoanCount: number; closedLoanCount: number }>(
    `/customers/${id}/profile360`
  ).then((r) => ({
    totalDisbursed: r.totalDisbursed ?? 0,
    totalOutstanding: r.totalOutstanding ?? 0,
    totalPaid: r.totalPaid ?? 0,
    activeLoanCount: r.activeLoanCount ?? 0,
    closedLoanCount: r.closedLoanCount ?? 0,
  }));
}
