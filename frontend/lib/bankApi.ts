import { apiFetch } from "@/lib/api";

/* Shape returned by the Go backend (backend/internal/bank/model.go). */
export type BackendBank = {
  id: number;
  name: string;
  branch: string;
  ifsc: string;
  accountNo: string;
  phone: string;
  createdAt: string;
  updatedAt: string;
};

/* Server-side search (by name) — backs the bank SearchableSelect in
 * RepledgeModal.tsx, same pattern as ornamentTypesApi.ts's search. */
export async function searchBanks(q: string): Promise<BackendBank[]> {
  const rec = await apiFetch<BackendBank[]>(`/banks?q=${encodeURIComponent(q)}`);
  return rec || [];
}

/* Page-shaped wrapper for SearchableSelect's fetchFn contract — see
 * ornamentTypesApi.ts's searchOrnamentTypesPage for why this is unpaginated
 * (the bank list is small reference data, same as ornament types). */
export async function searchBanksPage(q: string, page: number): Promise<{ items: BackendBank[]; hasMore: boolean }> {
  if (page > 0) return { items: [], hasMore: false };
  return { items: await searchBanks(q), hasMore: false };
}

/* Creates a new bank, or — if one with the same name (case insensitive)
 * already exists — returns the existing row instead (the backend's
 * find-or-create behaviour). */
export async function createBank(name: string): Promise<BackendBank> {
  return apiFetch<BackendBank>("/banks", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

/* Full "Add Bank" form submission — name + the descriptive fields. Same
 * find-or-create endpoint as createBank(); note branch/ifsc/phone are only
 * persisted when a NEW bank is created (an existing name-match is returned
 * as-is, per the backend's FindOrCreate semantics). */
export async function createBankFull(input: { name: string; branch: string; ifsc: string; accountNo: string; phone: string }): Promise<BackendBank> {
  return apiFetch<BackendBank>("/banks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
