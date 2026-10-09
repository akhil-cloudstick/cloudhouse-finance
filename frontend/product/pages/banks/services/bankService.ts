import { apiFetchEnveloped as apiFetch } from "@/product/services/httpClient";

/* Shape returned by the Go backend (backend/internal/bank/model.go). */
export type BackendBank = {
  id: number;
  name: string;
  // The business branch this account belongs to (mandatory) — GET /banks is
  // scoped by it via the X-Branch-Id header.
  branchId: number;
  branchName: string;
  // The BANK's own branch (free text, e.g. "Koratty") — not a business branch.
  branch: string;
  ifsc: string;
  accountNo: string;
  phone: string;
  // Current net balance of this account (money in less money out).
  balance: number;
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
export type BankFormInput = { name: string; branchId: number; branch: string; ifsc: string; accountNo: string; phone: string };

export async function createBankFull(input: BankFormInput): Promise<BackendBank> {
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

export const BANKS_PAGE_SIZE = 10;

/* Paginated variant of listBanks for the Bank Management admin table — the
 * backend's GET /banks already supports limit/offset/total (mirrors
 * loan/customer's List, see backend/internal/bank/handler.go), this just
 * wasn't wired up on the frontend yet. `page` is 1-based, same convention as
 * listLoansPage/listBankPledgeHistoryPage. `totalBalance` is the server's
 * sum of `balance` over every matching bank (not just this page) — the Bank
 * Management page's "Net Bank Balance" card. */
export async function listBanksPage(page: number, limit: number = BANKS_PAGE_SIZE): Promise<{ items: BackendBank[]; hasMore: boolean; total: number; totalBalance: number }> {
  const params = new URLSearchParams({ limit: String(limit), offset: String((page - 1) * limit) });
  const res = await apiFetch<{ items: BackendBank[] | null; hasMore: boolean; total?: number; totalBalance?: number }>(`/banks?${params}`);
  return { items: res.items || [], hasMore: !!res.hasMore, total: res.total ?? 0, totalBalance: res.totalBalance ?? 0 };
}

/* The Party Transactions page's bank-drill-down header needs the bank's own
 * name/details. */
export async function getBank(id: number): Promise<BackendBank> {
  return apiFetch<BackendBank>(`/banks/${id}`);
}

export async function updateBank(id: number, input: BankFormInput): Promise<BackendBank> {
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
