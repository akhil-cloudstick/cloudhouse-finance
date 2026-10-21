import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import { uploadFile as uploadSharedFile } from "@/common/services/uploadService";
import { isSmallScreen } from "@/common/utils/responsive";
import { toView as toLoanView, toAuctionRecordView, toCustomerOrnamentRowView, toCustomerPaymentRowView, toCustomerBankPledgeRowView, toCustomerAuctionRowView } from "@/modules/loans/services/loanService";
import { type BackendLoan, type LoanView, type BackendCustomerOrnamentRow, type CustomerOrnamentRowView, type BackendCustomerPaymentRow, type CustomerPaymentRowView, type BackendCustomerBankPledgeRow, type CustomerBankPledgeRowView, type BackendCustomerAuctionRow, type CustomerAuctionRowView } from "@/modules/loans/types/loan-types";
import type { BackendCustomer, CustomerView, CustomerFormInput, PanVerificationResult, AadhaarVerificationStart, AadhaarVerificationCheck, Customer360View, BackendCustomer360 } from "@/modules/customers/types/customer-types";

function toView(c: BackendCustomer): CustomerView {
  return {
    id: String(c.id),
    code: c.code,
    name: c.name,
    phone: c.phone,
    // "0001-01-01" is Go's zero time (DOB never entered) — treat as unset.
    dob: c.dob && !c.dob.startsWith("0001-") ? c.dob.slice(0, 10) : "",
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

// Checks panStatus/aadhaarStatus directly: the derived kycStatus collapses both into one "Pending" value.
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

export async function searchCustomers(q: string): Promise<CustomerView[]> {
  const rec = await apiFetch<BackendCustomer[]>(`/customers?q=${encodeURIComponent(q)}`);
  return (rec || []).map(toView);
}

const CUSTOMER_PAGE_SIZE = 5;

// `page` is 0-based.
export async function searchCustomersPage(q: string, page: number): Promise<{ items: CustomerView[]; hasMore: boolean }> {
  const params = new URLSearchParams({ q, limit: String(CUSTOMER_PAGE_SIZE), offset: String(page * CUSTOMER_PAGE_SIZE) });
  const rec = await apiFetch<{ items: BackendCustomer[]; hasMore: boolean }>(`/customers?${params}`);
  return { items: (rec?.items || []).map(toView), hasMore: !!rec?.hasMore };
}

export async function searchInvestorsPage(q: string, page: number): Promise<{ items: CustomerView[]; hasMore: boolean }> {
  const params = new URLSearchParams({ q, limit: String(CUSTOMER_PAGE_SIZE), offset: String(page * CUSTOMER_PAGE_SIZE), customerType: "Investor" });
  const rec = await apiFetch<{ items: BackendCustomer[]; hasMore: boolean }>(`/customers?${params}`);
  return { items: (rec?.items || []).map(toView), hasMore: !!rec?.hasMore };
}

export async function getCustomer(id: string): Promise<CustomerView> {
  const rec = await apiFetch<BackendCustomer>(`/customers/${id}`);
  return toView(rec);
}

export async function verifyCustomerPan(id: string): Promise<PanVerificationResult> {
  const res = await apiFetch<{ customer: BackendCustomer; message: string; matchedName: string; traceId: string }>(
    `/customers/${id}/verify-pan`,
    { method: "POST" }
  );
  return { customer: toView(res.customer), message: res.message, matchedName: res.matchedName, traceId: res.traceId };
}

// The one endpoint that ever returns more than AadhaarLast4; every other customer read stays last-4-only.
export async function getCustomerAadhaarFull(id: string): Promise<string> {
  const res = await apiFetch<{ aadhaar: string }>(`/customers/${id}/aadhaar-full`);
  return res.aadhaar;
}

export async function startAadhaarVerify(customerId: string, redirectUrl: string): Promise<AadhaarVerificationStart> {
  return apiFetch<AadhaarVerificationStart>(`/customers/${customerId}/verify-aadhaar/start`, {
    method: "POST",
    body: JSON.stringify({ redirectUrl }),
  });
}

export async function checkAadhaarVerify(customerId: string): Promise<AadhaarVerificationCheck> {
  const res = await apiFetch<{ status: string; customer?: BackendCustomer; matchedName?: string; dob?: string; failureReasons?: string[] }>(
    `/customers/${customerId}/verify-aadhaar/check`,
    { method: "POST" }
  );
  return { status: res.status, customer: res.customer ? toView(res.customer) : undefined, matchedName: res.matchedName, dob: res.dob, failureReasons: res.failureReasons ?? [] };
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

// Rejected if any of the customer's loans aren't yet Closed/Auctioned; the error names the offending loans.
export async function hardDeleteCustomer(id: string): Promise<void> {
  await apiFetch<void>(`/customers/${id}/hard-delete`, { method: "DELETE" });
}

// `range` narrows to loans opened within an inclusive date window; the backend filters and recomputes totals.
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

// --- Customer 360 sub-table pagination ---
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

export async function uploadFile(file: File): Promise<string> {
  return uploadSharedFile(file);
}
