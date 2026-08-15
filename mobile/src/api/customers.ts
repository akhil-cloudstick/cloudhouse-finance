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
// Photo/identity-proof/address-proof/kyc-document upload fields are
// deliberately omitted here — frontend/components/modals/RegisterCustomerModal.tsx
// collects those inline via <input type="file">, but there's no equivalent
// document-picker flow on mobile yet, so registration here mirrors only the
// text fields and defers document upload to a later KYC step (same split
// the modal itself draws between "register" and "verify").
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
}) {
  return apiRequest<Customer>("/customers", { method: "POST", body: input });
}
