import { apiRequestEnveloped as apiRequest } from "./client";
import { Bank } from "../types/bank";

export function listBanks(q?: string) {
  return apiRequest<Bank[]>("/banks", { params: { q } });
}

// Find-or-create, dedupes by name (case-insensitive) — 201 if new, 200 if
// matched an existing bank.
export function createBank(input: { name: string; branch?: string; ifsc?: string; accountNo?: string; phone?: string }) {
  return apiRequest<Bank>("/banks", { method: "POST", body: input });
}
