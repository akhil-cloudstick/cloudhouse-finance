import { apiRequestEnveloped as apiRequest } from "./client";
import { Branch } from "../types/branch";

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

export type BranchInput = {
  name: string;
  code?: string;
  address: string;
  phone?: string;
  isActive?: boolean;
};

export function createBranch(input: BranchInput) {
  return apiRequest<Branch>("/branches", { method: "POST", body: input });
}

export function updateBranch(id: number, input: BranchInput) {
  return apiRequest<Branch>(`/branches/${id}`, { method: "PUT", body: input });
}

export function deactivateBranch(id: number) {
  return apiRequest<Branch>(`/branches/${id}`, { method: "DELETE" });
}
