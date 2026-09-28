import { apiFetchEnveloped as apiFetch, apiUploadEnveloped as apiUpload } from "@/common/services/httpClient";
import { isSmallScreen } from "@/common/utils/responsive";
import type { BranchView } from "@/modules/branches/services/branchService";
import {
  toView as toLoanView,
  toAuctionRecordView,
  toCustomerOrnamentRowView,
  toCustomerPaymentRowView,
  toCustomerBankPledgeRowView,
  toCustomerAuctionRowView,
  type BackendLoan,
  type LoanView,
  type BackendAuctionRecord,
  type AuctionRecordView,
  type BackendCustomerOrnamentRow,
  type CustomerOrnamentRowView,
  type BackendCustomerPaymentRow,
  type CustomerPaymentRowView,
  type BackendCustomerBankPledgeRow,
  type CustomerBankPledgeRowView,
  type BackendCustomerAuctionRow,
  type CustomerAuctionRowView,
} from "@/modules/loans/services/loanService";

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
  // Personal-loan specific / optional (backend/internal/customer/model.go) —
  // only ever set via the inline "+ Add new customer" flow in the Personal
  // Loan creation picker (CreateCustomerModal.tsx). Absent/undefined for
  // every gold-loan customer.
  fatherName?: string;
  district?: string;
  taluk?: string;
  village?: string;
  place?: string;
  pinCode?: string;
  age?: number;
  // Investor-only / optional (backend/internal/customer/model.go) — set
  // only for customerType "Investor" (internal/investment). Absent/blank
  // for every ordinary Borrower customer.
  customerType?: "Borrower" | "Investor";
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
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
  // Personal-loan specific / optional — see BackendCustomer's own comment.
  fatherName?: string;
  district?: string;
  taluk?: string;
  village?: string;
  place?: string;
  pinCode?: string;
  age?: number;
  customerType?: "Borrower" | "Investor";
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
};

/* What RegisterCustomerModal.tsx collects. `aadhaar` is the plaintext
 * number, sent once at submit time — the backend encrypts it immediately
 * and never returns it in any response. */
export type CustomerFormInput = {
  name: string;
  phone: string;
  // Optional — RegisterCustomerModal.tsx no longer collects DOB at
  // registration time (not used anywhere on the customer). EditCustomerModal
  // still shows/edits it for a customer that already has one on file.
  dob?: string; // "YYYY-MM-DD"
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
  // Personal-loan specific / optional — collected only by
  // CreateCustomerModal.tsx (frontend/modules/personal-loans/components).
  fatherName?: string;
  district?: string;
  taluk?: string;
  village?: string;
  place?: string;
  pinCode?: string;
  age?: number;
  // Investor-only / optional — collected only by CreateInvestorModal.tsx
  // (frontend/modules/investments/components).
  customerType?: "Borrower" | "Investor";
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
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
    fatherName: c.fatherName,
    district: c.district,
    taluk: c.taluk,
    village: c.village,
    place: c.place,
    pinCode: c.pinCode,
    age: c.age,
    customerType: c.customerType,
    bankAccountName: c.bankAccountName,
    bankAccountNumber: c.bankAccountNumber,
    bankIfsc: c.bankIfsc,
  };
}

/* Three-way verification label for display (e.g. the new-loan customer
 * picker) — deliberately checks panStatus/aadhaarStatus directly rather
 * than the derived kycStatus, since kycStatus collapses "one of two
 * passed" and "neither passed" into the same "Pending" value (see
 * backend/internal/customer/service.go's deriveKYCStatus), but the UI
 * needs to tell those two apart. */
export function verificationLabel(c: { panStatus: string; aadhaarStatus: string }): "Verified" | "Part Verified" | "Unverified" {
  const panOK = c.panStatus === "Verified";
  const aadhaarOK = c.aadhaarStatus === "Verified";
  if (panOK && aadhaarOK) return "Verified";
  if (panOK || aadhaarOK) return "Part Verified";
  return "Unverified";
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
    fatherName: input.fatherName || undefined,
    district: input.district || undefined,
    taluk: input.taluk || undefined,
    village: input.village || undefined,
    place: input.place || undefined,
    pinCode: input.pinCode || undefined,
    age: input.age,
    customerType: input.customerType || undefined,
    bankAccountName: input.bankAccountName || undefined,
    bankAccountNumber: input.bankAccountNumber || undefined,
    bankIfsc: input.bankIfsc || undefined,
  };
}

export async function listCustomers(): Promise<CustomerView[]> {
  const rec = await apiFetch<BackendCustomer[]>("/customers");
  return (rec || []).map(toView);
}

export const CUSTOMERS_TABLE_PAGE_SIZE = 10;

/* Paginated variant of listCustomers for the Customers page's own table
 * (distinct from CUSTOMER_PAGE_SIZE below, which backs the SearchableSelect
 * picker's infinite scroll) — CustomersProvider still fetches the full,
 * unpaginated list for consumers that need every customer at once (global
 * search, New Loan's picker), so this is a separate call rather than a
 * change to listCustomers/CustomersProvider. */
export async function listCustomersPage(
  q: string,
  page: number,
  filters?: { panStatus?: string; aadhaarStatus?: string; branchIds?: string[] },
  limit?: number
): Promise<{ items: CustomerView[]; hasMore: boolean; total: number }> {
  const pageSize = limit ?? (isSmallScreen() ? 7 : 9);
  const params = new URLSearchParams({ q, limit: String(pageSize), offset: String((page - 1) * pageSize) });
  if (filters?.panStatus) params.set("panStatus", filters.panStatus);
  if (filters?.aadhaarStatus) params.set("aadhaarStatus", filters.aadhaarStatus);
  if (filters?.branchIds?.length) params.set("branchIds", filters.branchIds.join(","));
  const rec = await apiFetch<{ items: BackendCustomer[]; hasMore: boolean; total?: number }>(`/customers?${params}`);
  return { items: (rec?.items || []).map(toView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
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

/* Same as searchCustomersPage, narrowed to Investor customers only — backs
 * the investor picker in the New Investment flow
 * (frontend/modules/investments/components/NewInvestmentModal.tsx). */
export async function searchInvestorsPage(q: string, page: number): Promise<{ items: CustomerView[]; hasMore: boolean }> {
  const params = new URLSearchParams({ q, limit: String(CUSTOMER_PAGE_SIZE), offset: String(page * CUSTOMER_PAGE_SIZE), customerType: "Investor" });
  const rec = await apiFetch<{ items: BackendCustomer[]; hasMore: boolean }>(`/customers?${params}`);
  return { items: (rec?.items || []).map(toView), hasMore: !!rec?.hasMore };
}

export async function getCustomer(id: string): Promise<CustomerView> {
  const rec = await apiFetch<BackendCustomer>(`/customers/${id}`);
  return toView(rec);
}

/* Result of a live Setu PAN-verify call (POST /customers/:id/verify-pan —
 * see backend/internal/customer/handler.go's VerifyPAN). `customer` carries
 * the updated panStatus/kycStatus; `message`/`matchedName` are the raw
 * values Setu returned, shown as-is so staff see what Setu actually said
 * rather than just a status chip. */
export type PanVerificationResult = {
  customer: CustomerView;
  message: string;
  matchedName: string;
  traceId: string;
};

export async function verifyCustomerPan(id: string): Promise<PanVerificationResult> {
  const res = await apiFetch<{ customer: BackendCustomer; message: string; matchedName: string; traceId: string }>(
    `/customers/${id}/verify-pan`,
    { method: "POST" }
  );
  return { customer: toView(res.customer), message: res.message, matchedName: res.matchedName, traceId: res.traceId };
}

/* Full, decrypted Aadhaar number (GET /customers/:id/aadhaar-full) — the
 * one endpoint that ever returns more than AadhaarLast4. Used solely to
 * prefill the printable pledge agreement (modules/loans/utils/
 * indemnityBond.ts); every other customer read stays last-4-only. */
export async function getCustomerAadhaarFull(id: string): Promise<string> {
  const res = await apiFetch<{ aadhaar: string }>(`/customers/${id}/aadhaar-full`);
  return res.aadhaar;
}

/* DigiLocker Aadhaar verification is a redirect flow, not a single call —
 * see backend/internal/customer/handler.go's StartAadhaarVerify/
 * CheckAadhaarVerify. startAadhaarVerify opens a login URL the CUSTOMER
 * (not staff) completes on their own device via Aadhaar + OTP; the caller
 * then polls checkAadhaarVerify until status flips to "authenticated". */
export type AadhaarVerificationStart = {
  id: string;
  url: string;
  status: string;
  validUpto: string;
};

export async function startAadhaarVerify(customerId: string, redirectUrl: string): Promise<AadhaarVerificationStart> {
  return apiFetch<AadhaarVerificationStart>(`/customers/${customerId}/verify-aadhaar/start`, {
    method: "POST",
    body: JSON.stringify({ redirectUrl }),
  });
}

export type AadhaarVerificationCheck = {
  status: string; // "unauthenticated" | "authenticated"
  customer?: CustomerView;
  matchedName?: string;
  dob?: string;
};

export async function checkAadhaarVerify(customerId: string): Promise<AadhaarVerificationCheck> {
  const res = await apiFetch<{ status: string; customer?: BackendCustomer; matchedName?: string; dob?: string }>(
    `/customers/${customerId}/verify-aadhaar/check`,
    { method: "POST" }
  );
  return { status: res.status, customer: res.customer ? toView(res.customer) : undefined, matchedName: res.matchedName, dob: res.dob };
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

/* Permanently deletes the customer and every record tied to them (loans and
 * everything under each one, device/OTP login records, notifications,
 * standalone reminders) — see backend/internal/customer/harddelete.go.
 * Rejected (thrown) if any of the customer's loans aren't yet Closed/
 * Auctioned; the thrown error's message names the offending loan number(s). */
export async function hardDeleteCustomer(id: string): Promise<void> {
  await apiFetch<void>(`/customers/${id}/hard-delete`, { method: "DELETE" });
}

/* Customer 360° profile — one consolidated view of every loan (with its
 * ornaments/payments/bank pledges) and every auction case for a customer,
 * backed by GET /api/v1/customers/:id/profile360 (see
 * backend/internal/loan/service.go's GetCustomer360 — lives in the loan
 * package to avoid a customer<->loan import cycle, but mounted under
 * /customers). Replaces CustomerDetail.tsx's old client-side filter over
 * the shared useLoans() list, which only ever showed a bare loan table —
 * no ornament/payment/bank-pledge/auction history. */
export type Customer360View = {
  customer: CustomerView;
  loans: LoanView[];
  auctionHistory: AuctionRecordView[];
  totalDisbursed: number;
  totalOutstanding: number;
  totalPaid: number;
  activeLoanCount: number;
  closedLoanCount: number;
};

type BackendCustomer360 = {
  customer: BackendCustomer;
  loans: BackendLoan[];
  auctionHistory: BackendAuctionRecord[] | null;
  totalDisbursed: number;
  totalOutstanding: number;
  totalPaid: number;
  activeLoanCount: number;
  closedLoanCount: number;
};

/* `range` narrows the profile to loans opened within an inclusive
 * YYYY-MM-DD window — the filtering is done by the backend (which also
 * recomputes the totals over the narrowed set), so both bounds are passed
 * straight through as query params rather than filtered client-side. */
export async function getCustomer360(
  id: string,
  range?: { from?: string; to?: string }
): Promise<Customer360View> {
  const qs = new URLSearchParams();
  if (range?.from) qs.set("from", range.from);
  if (range?.to) qs.set("to", range.to);
  const suffix = qs.toString() ? `?${qs}` : "";
  const rec = await apiFetch<BackendCustomer360>(`/customers/${id}/profile360${suffix}`);
  return {
    customer: toView(rec.customer),
    loans: (rec.loans || []).map(toLoanView),
    auctionHistory: (rec.auctionHistory || []).map(toAuctionRecordView),
    totalDisbursed: rec.totalDisbursed,
    totalOutstanding: rec.totalOutstanding,
    totalPaid: rec.totalPaid,
    activeLoanCount: rec.activeLoanCount,
    closedLoanCount: rec.closedLoanCount,
  };
}

/* --- Customer 360 sub-table pagination ------------------------------------
 * The 5 sub-tables on CustomerDetail.tsx (Loan History, Pledged Ornaments,
 * Payment History, Bank Pledges, Auction History) used to be sliced
 * client-side out of getCustomer360's single big payload. They're now
 * fetched independently, one paginated call per page per table, following
 * this codebase's limit/offset + {items, hasMore} convention (see
 * loanService.ts's listLoansPage) — each backed by its own
 * GET /customers/:id/{loans,ornaments,payments,bank-pledges,
 * auction-history} endpoint (backend/internal/loan/handler.go). `range`
 * mirrors getCustomer360's from/to opened-date window. */
/* 9 rows — the height the 360 view's table card is sized for, so a full
 * page fills it exactly without the card growing. */
export const CUSTOMER_SUBTABLE_PAGE_SIZE = 10;

function subTableParams(page: number, range?: { from?: string; to?: string }, limit?: number): URLSearchParams {
  const pageSize = limit ?? (isSmallScreen() ? 7 : 10);
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
  });
  if (range?.from) params.set("from", range.from);
  if (range?.to) params.set("to", range.to);
  return params;
}

export async function listCustomerLoansPage(
  customerId: string,
  page: number,
  range?: { from?: string; to?: string },
  limit?: number
): Promise<{ items: LoanView[]; hasMore: boolean; total: number }> {
  const params = subTableParams(page, range, limit);
  const rec = await apiFetch<{ items: BackendLoan[]; hasMore: boolean; total?: number }>(`/customers/${customerId}/loans?${params}`);
  return { items: (rec?.items || []).map(toLoanView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
}

export async function listCustomerOrnamentsPage(
  customerId: string,
  page: number,
  range?: { from?: string; to?: string },
  limit?: number
): Promise<{ items: CustomerOrnamentRowView[]; hasMore: boolean; total: number }> {
  const params = subTableParams(page, range, limit);
  const rec = await apiFetch<{ items: BackendCustomerOrnamentRow[]; hasMore: boolean; total?: number }>(`/customers/${customerId}/ornaments?${params}`);
  return { items: (rec?.items || []).map(toCustomerOrnamentRowView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
}

export async function listCustomerPaymentsPage(
  customerId: string,
  page: number,
  range?: { from?: string; to?: string },
  limit?: number
): Promise<{ items: CustomerPaymentRowView[]; hasMore: boolean; total: number }> {
  const params = subTableParams(page, range, limit);
  const rec = await apiFetch<{ items: BackendCustomerPaymentRow[]; hasMore: boolean; total?: number }>(`/customers/${customerId}/payments?${params}`);
  return { items: (rec?.items || []).map(toCustomerPaymentRowView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
}

export async function listCustomerBankPledgesPage(
  customerId: string,
  page: number,
  range?: { from?: string; to?: string },
  limit?: number
): Promise<{ items: CustomerBankPledgeRowView[]; hasMore: boolean; total: number }> {
  const params = subTableParams(page, range, limit);
  const rec = await apiFetch<{ items: BackendCustomerBankPledgeRow[]; hasMore: boolean; total?: number }>(`/customers/${customerId}/bank-pledges?${params}`);
  return { items: (rec?.items || []).map(toCustomerBankPledgeRowView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
}

export async function listCustomerAuctionHistoryPage(
  customerId: string,
  page: number,
  range?: { from?: string; to?: string },
  limit?: number
): Promise<{ items: CustomerAuctionRowView[]; hasMore: boolean; total: number }> {
  const params = subTableParams(page, range, limit);
  const rec = await apiFetch<{ items: BackendCustomerAuctionRow[]; hasMore: boolean; total?: number }>(`/customers/${customerId}/auction-history?${params}`);
  return { items: (rec?.items || []).map(toCustomerAuctionRowView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
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
