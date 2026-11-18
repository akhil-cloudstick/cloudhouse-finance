import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import type { Customer, CustomerInput } from "@/modules/customers/types/customer-types";

// Investors are their own records (backend table `investors`), separate from customers; the endpoints answer in
// the customer shape. Same API as web's investorService.
export type Investor = Customer & Partial<{ bankAccountName: string; bankAccountNumber: string; bankIfsc: string }>;

export function listInvestorsPage(params: { q?: string; limit: number; offset: number; branchIds?: number[] }) {
  const { branchIds, ...rest } = params;
  return apiRequest<{ items: Investor[]; hasMore: boolean; total?: number }>("/investors", {
    params: { ...rest, branchIds: branchIds?.length ? branchIds.join(",") : undefined },
  });
}

export function getInvestor(id: number) {
  return apiRequest<Investor>(`/investors/${id}`);
}

export function getInvestorAadhaarFull(id: number) {
  return apiRequest<{ aadhaar: string }>(`/investors/${id}/aadhaar-full`).then((r) => r.aadhaar);
}

/** An investor already on file with the same phone / PAN / Aadhaar under a different name (the server's 409 body). */
export type SameIdentityMatch = { id: number; source: "investor" | "customer"; code: string; name: string; phone: string; fields: string[] };

/** The matches in a "same person?" 409, or null for any other error. */
export function sameIdentityMatches(e: unknown): SameIdentityMatch[] | null {
  const body = (e as { status?: number; body?: { code?: string; matches?: SameIdentityMatch[] } } | null);
  return body?.status === 409 && body.body?.code === "same_identity_different_name" && Array.isArray(body.body.matches) ? body.body.matches : null;
}

/** confirmSamePerson: the user confirmed this is the same person as the existing investor(s) sharing a number. */
export function createInvestor(input: CustomerInput, confirmSamePerson?: boolean) {
  return apiRequest<Investor>("/investors", { method: "POST", body: input, params: confirmSamePerson ? { confirm_same_person: "true" } : undefined });
}

export function updateInvestor(id: number, input: CustomerInput) {
  return apiRequest<Investor>(`/investors/${id}`, { method: "PUT", body: input });
}

// Refused (409) while any investment is still on file; the message names each one.
export function hardDeleteInvestor(id: number) {
  return apiRequest<void>(`/investors/${id}/hard-delete`, { method: "DELETE" });
}
