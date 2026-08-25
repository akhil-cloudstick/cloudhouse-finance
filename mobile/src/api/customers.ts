import { apiRequestEnveloped as apiRequest } from "./client";
import { Customer } from "../types/customer";

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
