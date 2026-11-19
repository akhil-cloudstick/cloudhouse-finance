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

/* `fromCustomerId` makes an existing customer an investor: the server carries over the Aadhaar number it holds. */
/* An existing investor already on file with the same phone number, PAN or Aadhaar under a different name — what the
 * server answers a new investor with (409, code "same_identity_different_name") until the user confirms. */
export type SameIdentityMatch = { id: number; source: "investor" | "customer"; code: string; name: string; phone: string; fields: string[] };

/* The matches in a "same person?" 409, or null when `e` is some other error. */
export function sameIdentityMatches(e: unknown): SameIdentityMatch[] | null {
  const d = (e as { status?: number; data?: { code?: string; matches?: SameIdentityMatch[] } } | null);
  return d?.status === 409 && d.data?.code === "same_identity_different_name" && Array.isArray(d.data.matches) ? d.data.matches : null;
}

/* Existing borrowers that share the phone number, PAN or Aadhaar being typed into the Add Investor form — asked while
 * the form is filled in, so a known borrower is offered straight away rather than only when Create is pressed.
 * Nothing is saved; the Aadhaar number goes in the body, not the URL. */
export async function checkInvestorIdentity(input: { phone: string; pan: string; aadhaar: string }): Promise<SameIdentityMatch[]> {
  const res = await apiFetch<{ matches: SameIdentityMatch[] | null }>("/investors/identity-check", { method: "POST", body: JSON.stringify(input) });
  return res.matches ?? [];
}

/* The reverse, for the Register Customer form: existing investors that share the phone number, PAN or Aadhaar being
 * typed. Same behaviour as checkInvestorIdentity; nothing is saved. */
export async function checkBorrowerIdentity(input: { phone: string; pan: string; aadhaar: string }): Promise<SameIdentityMatch[]> {
  const res = await apiFetch<{ matches: SameIdentityMatch[] | null }>("/customers/identity-check", { method: "POST", body: JSON.stringify(input) });
  return res.matches ?? [];
}

/* confirmSamePerson: the user has confirmed this investor is the same person as the existing one(s) that share
 * a phone number, PAN or Aadhaar under another name. */
export async function createInvestor(input: CustomerFormInput, fromCustomerId?: string, confirmSamePerson?: boolean): Promise<CustomerView> {
  const q = new URLSearchParams();
  if (fromCustomerId) q.set("from_customer_id", fromCustomerId);
  if (confirmSamePerson) q.set("confirm_same_person", "true");
  const rec = await apiFetch<BackendCustomer>(`/investors${q.size ? `?${q}` : ""}`, { method: "POST", body: JSON.stringify(toRequestBody(input)) });
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
