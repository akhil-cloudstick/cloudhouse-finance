import { apiRequestEnveloped as apiRequest } from "./client";
import { Customer } from "../types/customer";
import { CustomerOrnamentRow, CustomerPaymentRow, CustomerBankPledgeRow, CustomerAuctionRow } from "../types/loan";

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
// Customers list (10/page, one API call per page).
export function listCustomersPage(params: { q?: string; limit: number; offset: number }) {
  return apiRequest<{ items: Customer[]; hasMore: boolean }>("/customers", { params });
}

export function getCustomer(id: number) {
  return apiRequest<Customer>(`/customers/${id}`);
}

// Full, decrypted Aadhaar number (GET /customers/:id/aadhaar-full) — the
// one endpoint that ever returns more than AadhaarLast4. Used solely to
// prefill the printable pledge agreement — see src/utils/loanPrint.ts.
export function getCustomerAadhaarFull(id: number) {
  return apiRequest<{ aadhaar: string }>(`/customers/${id}/aadhaar-full`);
}

// --- Customer-profile sub-tabs (backend/internal/loan/handler.go's
// ListOrnamentsForCustomer/ListPaymentsForCustomer/ListBankPledgesForCustomer/
// ListAuctionHistoryForCustomer) — mirrors frontend/modules/customers/
// services/customerService.ts's listCustomer*Page functions, but in this
// app's {items,hasMore}+limit/offset convention (useInfiniteQuery, see
// loans/index.tsx) rather than the web's 1-based page-number pager. Loan
// History itself isn't here — it's already covered by
// src/api/loans.ts's listLoansPage({customerId}).
function customerSubTable<T>(path: string, customerId: number, limit: number, offset: number) {
  return apiRequest<{ items: T[]; hasMore: boolean }>(`/customers/${customerId}/${path}`, {
    params: { limit, offset },
  });
}

export function listCustomerOrnamentsPage(customerId: number, limit: number, offset: number) {
  return customerSubTable<CustomerOrnamentRow>("ornaments", customerId, limit, offset);
}
export function listCustomerPaymentsPage(customerId: number, limit: number, offset: number) {
  return customerSubTable<CustomerPaymentRow>("payments", customerId, limit, offset);
}
export function listCustomerBankPledgesPage(customerId: number, limit: number, offset: number) {
  return customerSubTable<CustomerBankPledgeRow>("bank-pledges", customerId, limit, offset);
}
export function listCustomerAuctionHistoryPage(customerId: number, limit: number, offset: number) {
  return customerSubTable<CustomerAuctionRow>("auction-history", customerId, limit, offset);
}

// Mirrors backend/internal/customer/handler.go's customerRequest body shape
// exactly (name/phone required; dob/address optional; branchId required).
//
// The document fields carry "/uploads/..." URLs, not file bytes: the mobile
// register screen uploads each pick immediately via src/api/uploads.ts and
// only sends the resulting URLs here — the same two-step the web modal does
// in save() (uploadFile ×4, then createCustomer).
export function createCustomer(input: {
  name: string;
  phone: string;
  dob?: string;
  address?: string;
  branchId: number;
  pan?: string;
  aadhaar?: string;
  nomineeName?: string;
  nomineeRelation?: string;
  nomineePhone?: string;
  photoUrl?: string;
  identityProofUrl?: string;
  addressProofUrl?: string;
  kycDocumentUrl?: string;
}) {
  return apiRequest<Customer>("/customers", { method: "POST", body: input });
}

// Same shape as createCustomer's body — backend/internal/customer/handler.go's
// Update does a full-replace PUT with the same customerRequest struct as
// Create, so the edit screen re-sends every field, not a partial patch.
// Leaving `aadhaar` empty keeps the on-file Aadhaar untouched (service.go's
// Update only re-encrypts when non-empty); leaving a document URL as the
// customer's existing value (rather than "") keeps that document instead of
// wiping it, since the backend has no notion of "unchanged" vs "cleared".
export function updateCustomer(
  id: number,
  input: {
    name: string;
    phone: string;
    dob?: string;
    address?: string;
    branchId: number;
    pan?: string;
    aadhaar?: string;
    nomineeName?: string;
    nomineeRelation?: string;
    nomineePhone?: string;
    photoUrl?: string;
    identityProofUrl?: string;
    addressProofUrl?: string;
    kycDocumentUrl?: string;
  }
) {
  return apiRequest<Customer>(`/customers/${id}`, { method: "PUT", body: input });
}
