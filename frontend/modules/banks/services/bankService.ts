import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";

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
 * as-is, per the backend's FindOrCreate semantics). Used by both the
 * bank-picker's inline "add new" flow and the Bank Management admin page's
 * "Add Bank" form — a name collision there just reuses the existing row,
 * which is a reasonable admin outcome too (see backend Service.Update's own
 * doc comment for why RENAMING instead rejects a collision outright). */
export async function createBankFull(input: { name: string; branch: string; ifsc: string; accountNo: string; phone: string }): Promise<BackendBank> {
  return apiFetch<BackendBank>("/banks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/* Bank Management admin page's list — no pagination at this scale, same
 * convention as Branches.tsx/listBranches(). */
export async function listBanks(): Promise<BackendBank[]> {
  return (await apiFetch<BackendBank[]>("/banks")) || [];
}

/* The Party Transactions page's bank-drill-down header needs the bank's own
 * name/details. */
export async function getBank(id: number): Promise<BackendBank> {
  return apiFetch<BackendBank>(`/banks/${id}`);
}

export async function updateBank(id: number, input: { name: string; branch: string; ifsc: string; accountNo: string; phone: string }): Promise<BackendBank> {
  return apiFetch<BackendBank>(`/banks/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

/* Hard-deletes a bank — the backend refuses (409) while any transaction or
 * bank-pledge record still references it; the caller should catch that and
 * point staff at mergeBanks instead. */
export async function deleteBank(id: number): Promise<void> {
  await apiFetch<{ deleted: boolean }>(`/banks/${id}`, { method: "DELETE" });
}

/* Reassigns every transaction/pledge from sourceId onto targetId, then
 * deletes sourceId (now unreferenced) — the "merge duplicate bank" action.
 * Returns the surviving (target) bank. */
export async function mergeBanks(sourceId: number, targetId: number): Promise<BackendBank> {
  return apiFetch<BackendBank>(`/banks/${sourceId}/merge`, {
    method: "POST",
    body: JSON.stringify({ targetId }),
  });
}
