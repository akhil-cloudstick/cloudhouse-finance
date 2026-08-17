import { apiRequest } from "./client";
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
