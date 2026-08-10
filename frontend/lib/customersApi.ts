import { apiFetch, apiUpload } from "@/lib/api";
import type { BranchView } from "@/lib/branchApi";

/* Shape returned by the Go backend (backend/internal/customer/model.go's
 * CustomerResponse — deliberately never the raw DB model, so there is no
 * Aadhaar ciphertext field to accidentally type in here). */
export type BackendCustomer = {
  id: number;
  code: string;
  name: string;
  phone: string;
  dob: string; // RFC3339
  address: string;
  branchId: number;
  branch: BranchView;
  photoUrl: string;
  identityProofUrl: string;
  addressProofUrl: string;
  kycDocumentUrl: string;
  pan: string;
  aadhaarLast4: string;
  nomineeName: string;
  nomineeRelation: string;
  nomineePhone: string;
  kycStatus: string;
  panStatus: string;
  aadhaarStatus: string;
  createdAt: string;
  updatedAt: string;
};

/* UI-facing shape — `id` is the stringified backend numeric id (matches the
 * convention already established by SchemeView), plus a flattened
 * `branchName` for display convenience. */
export type CustomerView = {
  id: string;
  code: string;
  name: string;
  phone: string;
  dob: string; // "YYYY-MM-DD", or "" if unset
  address: string;
  branchId: number;
  branchName: string;
  photoUrl: string;
  identityProofUrl: string;
  addressProofUrl: string;
  kycDocumentUrl: string;
  pan: string;
  aadhaarLast4: string;
  nomineeName: string;
  nomineeRelation: string;
  nomineePhone: string;
  kycStatus: string;
  panStatus: string;
  aadhaarStatus: string;
};

/* What RegisterCustomerModal.tsx collects. `aadhaar` is the plaintext
 * number, sent once at submit time — the backend encrypts it immediately
 * and never returns it in any response. */
export type CustomerFormInput = {
  name: string;
  phone: string;
  dob: string; // "YYYY-MM-DD"
  address: string;
  branchId: number;
  photoUrl: string;
  identityProofUrl: string;
  addressProofUrl: string;
  kycDocumentUrl: string;
  pan: string;
  aadhaar: string;
  nomineeName: string;
  nomineeRelation: string;
  nomineePhone: string;
};

function toView(c: BackendCustomer): CustomerView {
  return {
    id: String(c.id),
    code: c.code,
    name: c.name,
    phone: c.phone,
    dob: c.dob ? c.dob.slice(0, 10) : "",
    address: c.address,
    branchId: c.branchId,
    branchName: c.branch?.name || "—",
    photoUrl: c.photoUrl,
    identityProofUrl: c.identityProofUrl,
    addressProofUrl: c.addressProofUrl,
    kycDocumentUrl: c.kycDocumentUrl,
    pan: c.pan,
    aadhaarLast4: c.aadhaarLast4,
    nomineeName: c.nomineeName,
    nomineeRelation: c.nomineeRelation,
    nomineePhone: c.nomineePhone,
    kycStatus: c.kycStatus,
    panStatus: c.panStatus,
    aadhaarStatus: c.aadhaarStatus,
  };
}

function toRequestBody(input: CustomerFormInput) {
  return {
    name: input.name,
    phone: input.phone,
    dob: input.dob || undefined,
    address: input.address,
    branchId: input.branchId,
    photoUrl: input.photoUrl,
    identityProofUrl: input.identityProofUrl,
    addressProofUrl: input.addressProofUrl,
    kycDocumentUrl: input.kycDocumentUrl,
    pan: input.pan,
    aadhaar: input.aadhaar,
    nomineeName: input.nomineeName,
    nomineeRelation: input.nomineeRelation,
    nomineePhone: input.nomineePhone,
  };
}

export async function listCustomers(): Promise<CustomerView[]> {
  const rec = await apiFetch<BackendCustomer[]>("/customers");
  return (rec || []).map(toView);
}

/* Server-side search across name/code/phone — backs SearchableSelect
 * pickers (see NewLoan.tsx) instead of filtering the full listCustomers()
 * result client-side. */
export async function searchCustomers(q: string): Promise<CustomerView[]> {
  const rec = await apiFetch<BackendCustomer[]>(`/customers?q=${encodeURIComponent(q)}`);
  return (rec || []).map(toView);
}

const CUSTOMER_PAGE_SIZE = 5;

/* Paginated variant of searchCustomers — backs SearchableSelect's infinite
 * scroll (see SearchableSelect.tsx). `page` is 0-based; the backend
 * responds with an {items, hasMore} envelope whenever `limit` is passed
 * (see backend/internal/customer/handler.go's List). */
export async function searchCustomersPage(q: string, page: number): Promise<{ items: CustomerView[]; hasMore: boolean }> {
  const params = new URLSearchParams({ q, limit: String(CUSTOMER_PAGE_SIZE), offset: String(page * CUSTOMER_PAGE_SIZE) });
  const rec = await apiFetch<{ items: BackendCustomer[]; hasMore: boolean }>(`/customers?${params}`);
  return { items: (rec?.items || []).map(toView), hasMore: !!rec?.hasMore };
}

export async function getCustomer(id: string): Promise<CustomerView> {
  const rec = await apiFetch<BackendCustomer>(`/customers/${id}`);
  return toView(rec);
}

export async function createCustomer(input: CustomerFormInput): Promise<CustomerView> {
  const rec = await apiFetch<BackendCustomer>("/customers", {
    method: "POST",
    body: JSON.stringify(toRequestBody(input)),
  });
  return toView(rec);
}

export async function updateCustomer(id: string, input: CustomerFormInput): Promise<CustomerView> {
  const rec = await apiFetch<BackendCustomer>(`/customers/${id}`, {
    method: "PUT",
    body: JSON.stringify(toRequestBody(input)),
  });
  return toView(rec);
}

export async function deleteCustomer(id: string): Promise<void> {
  await apiFetch<void>(`/customers/${id}`, { method: "DELETE" });
}

/* Uploads one file (photo/identity proof/address proof/KYC document) to the
 * shared upload endpoint (backend/internal/upload) and returns the URL to
 * store on the customer record. */
export async function uploadFile(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await apiUpload<{ url: string }>("/uploads", formData);
  return res.url;
}
