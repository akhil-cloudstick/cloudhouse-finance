import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import { toView, toRequestBody } from "@/modules/customers/services/customerService";
import type { BackendCustomer, CustomerView, CustomerFormInput } from "@/modules/customers/types/customer-types";

/* Investors are their own records (backend table `investors`), separate from customers, so the same person can
 * be a borrower and an investor with the same phone / PAN / Aadhaar. The endpoints answer in the same shape as
 * a customer, so the customer view type is reused. */

const INVESTOR_PICKER_PAGE_SIZE = 5;

/* One page (1-based) of investors, searched on the server by name / code / phone. */
export async function listInvestorsPage(
  q: string,
  page: number,
  filters?: { branchIds?: string[] },
  limit = 10
): Promise<{ items: CustomerView[]; hasMore: boolean; total: number }> {
  const params = new URLSearchParams({ q, limit: String(limit), offset: String((page - 1) * limit) });
  if (filters?.branchIds?.length) params.set("branchIds", filters.branchIds.join(","));
  const rec = await apiFetch<{ items: BackendCustomer[]; hasMore: boolean; total?: number }>(`/investors?${params}`);
  return { items: (rec?.items || []).map(toView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
}

/* 0-based page, for SearchableSelect pickers (New Investment's investor field). */
export async function searchInvestorsPage(q: string, page: number): Promise<{ items: CustomerView[]; hasMore: boolean }> {
  const params = new URLSearchParams({ q, limit: String(INVESTOR_PICKER_PAGE_SIZE), offset: String(page * INVESTOR_PICKER_PAGE_SIZE) });
  const rec = await apiFetch<{ items: BackendCustomer[]; hasMore: boolean }>(`/investors?${params}`);
  return { items: (rec?.items || []).map(toView), hasMore: !!rec?.hasMore };
}

export async function getInvestor(id: string): Promise<CustomerView> {
  return toView(await apiFetch<BackendCustomer>(`/investors/${id}`));
}

/* The decrypted Aadhaar number, to prefill the edit form. */
export async function getInvestorAadhaarFull(id: string): Promise<string> {
  const res = await apiFetch<{ aadhaar: string }>(`/investors/${id}/aadhaar-full`);
  return res.aadhaar;
}

export async function createInvestor(input: CustomerFormInput): Promise<CustomerView> {
  const rec = await apiFetch<BackendCustomer>("/investors", { method: "POST", body: JSON.stringify(toRequestBody(input)) });
  return toView(rec);
}

export async function updateInvestor(id: string, input: CustomerFormInput): Promise<CustomerView> {
  const rec = await apiFetch<BackendCustomer>(`/investors/${id}`, { method: "PUT", body: JSON.stringify(toRequestBody(input)) });
  return toView(rec);
}

/* Permanently deletes an investor. Refused (thrown, 409) while any investment is still on file; the message
 * names each one. */
export async function hardDeleteInvestor(id: string): Promise<void> {
  await apiFetch<void>(`/investors/${id}/hard-delete`, { method: "DELETE" });
}
