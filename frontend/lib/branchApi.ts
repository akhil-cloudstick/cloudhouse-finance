import { apiFetch } from "@/lib/api";

/* Shape returned by the Go backend (backend/internal/branch/model.go). */
export type BranchView = {
  id: number;
  name: string;
  code: string;
  address: string;
  phone: string;
  isActive: boolean;
};

export type BranchFormInput = {
  name: string;
  code: string;
  address: string;
  phone: string;
  isActive: boolean;
};

export async function listBranches(): Promise<BranchView[]> {
  const rec = await apiFetch<BranchView[]>("/branches");
  return rec || [];
}

export async function getBranch(id: number): Promise<BranchView> {
  return apiFetch<BranchView>(`/branches/${id}`);
}

export async function createBranch(input: BranchFormInput): Promise<BranchView> {
  return apiFetch<BranchView>("/branches", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateBranch(id: number, input: BranchFormInput): Promise<BranchView> {
  return apiFetch<BranchView>(`/branches/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/* Deactivates the branch (soft-disable) rather than a hard delete, so
 * historical records that still reference it (employees, expenses, cash
 * movements) keep a valid branch reference. */
export async function deactivateBranch(id: number): Promise<BranchView> {
  return apiFetch<BranchView>(`/branches/${id}`, { method: "DELETE" });
}

/* Only branches an admin should be able to pick from a dropdown when
 * assigning new records — excludes deactivated branches. */
export async function listActiveBranches(): Promise<BranchView[]> {
  const all = await listBranches();
  return all.filter((b) => b.isActive);
}
