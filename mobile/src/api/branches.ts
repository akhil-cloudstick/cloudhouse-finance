import { apiRequestEnveloped as apiRequest } from "./client";
import { Branch } from "../types/branch";

export function listBranches() {
  return apiRequest<Branch[]>("/branches");
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
