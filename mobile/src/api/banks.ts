import { apiRequestEnveloped as apiRequest } from "./client";
import { Bank } from "../types/bank";

export function listBanks(q?: string) {
  return apiRequest<Bank[]>("/banks", { params: { q } });
}

// Page-scoped variant: passing `limit` flips the backend (bank/handler.go's
// List) into the {items, hasMore} envelope — used by the paginated mobile
// Bank Pledge directory (10/page, one API call per page).
export function listBanksPage(params: { q?: string; limit: number; offset: number }) {
  return apiRequest<{ items: Bank[]; hasMore: boolean }>("/banks", { params });
}

// Find-or-create, dedupes by name (case-insensitive) — 201 if new, 200 if
// matched an existing bank.
export function createBank(input: { name: string; branch?: string; ifsc?: string; accountNo?: string; phone?: string }) {
  return apiRequest<Bank>("/banks", { method: "POST", body: input });
}
