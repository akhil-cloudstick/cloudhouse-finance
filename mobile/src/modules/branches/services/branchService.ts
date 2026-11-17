import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import { Branch, type BranchInput, type SwitchableBranches } from "@/modules/branches/types/branch-types";

// Feeds the header's branch switcher (GET /branches/switchable) — never branch-scoped, so it still lists every
// branch after one has been selected.
export async function listSwitchableBranches(): Promise<SwitchableBranches> {
  const rec = await apiRequest<SwitchableBranches>("/branches/switchable");
  return rec || { branches: [], canSwitch: false };
}

export function listBranches() {
  return apiRequest<Branch[]>("/branches");
}

// Paged + searchable (`q`: name / code / address) — GET /branches?limit&offset.
export function listBranchesPage(params: { q?: string; active?: boolean; limit: number; offset: number }) {
  return apiRequest<{ items: Branch[]; hasMore: boolean; total?: number }>("/branches", { params });
}

export function getBranch(id: number) {
  return apiRequest<Branch>(`/branches/${id}`);
}

export function createBranch(input: BranchInput) {
  return apiRequest<Branch>("/branches", { method: "POST", body: input });
}

export function updateBranch(id: number, input: BranchInput) {
  return apiRequest<Branch>(`/branches/${id}`, { method: "PUT", body: input });
}

export function deactivateBranch(id: number) {
  return apiRequest<Branch>(`/branches/${id}`, { method: "DELETE" });
}
