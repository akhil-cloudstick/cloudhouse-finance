import { apiFetchEnveloped, ApiError } from "@/common/services/httpClient";
import type { BranchView, BranchFormInput, SwitchableBranches, BranchQuota } from "@/modules/branches/types/branch-types";

export async function listBranches(): Promise<BranchView[]> {
  const rec = await apiFetchEnveloped<BranchView[]>("/branches");
  return rec || [];
}

export async function listSwitchableBranches(): Promise<SwitchableBranches> {
  const rec = await apiFetchEnveloped<SwitchableBranches>("/branches/switchable");
  return rec || { branches: [], canSwitch: false };
}

export async function getBranchQuota(): Promise<BranchQuota> {
  return apiFetchEnveloped<BranchQuota>("/branches/quota");
}

export async function getBranch(id: number): Promise<BranchView> {
  return apiFetchEnveloped<BranchView>(`/branches/${id}`);
}

export async function createBranch(input: BranchFormInput): Promise<BranchView> {
  return apiFetchEnveloped<BranchView>("/branches", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateBranch(id: number, input: BranchFormInput): Promise<BranchView> {
  return apiFetchEnveloped<BranchView>(`/branches/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/* Deactivates the branch (soft-disable) rather than a hard delete, so
 * historical records that still reference it (employees, expenses, cash
 * movements) keep a valid branch reference. */
export async function deactivateBranch(id: number): Promise<BranchView> {
  return apiFetchEnveloped<BranchView>(`/branches/${id}`, { method: "DELETE" });
}

/* Only branches an admin should be able to pick from a dropdown when
 * assigning new records — excludes deactivated branches. */
/* The signed-in employee's own branch (set by auth-context). A role without
 * "can view branch module" still fills branch pickers with it: every role
 * except Administrator/Management only ever works in its own branch, and the
 * backend forces that on every write regardless. When the role is known to
 * lack that permission, GET /branches is not called at all — its 403 would
 * raise the global "no access" toast on every page with a branch picker. */
let ownBranchFallback: BranchView | null = null;
let canListBranches = true;
export function setOwnBranchFallback(branch: { id: number; name: string; code?: string } | null, canList = true) {
  ownBranchFallback = branch
    ? { id: branch.id, name: branch.name, code: branch.code || "", address: "", phone: "", isActive: true }
    : null;
  canListBranches = canList;
}

export async function listActiveBranches(): Promise<BranchView[]> {
  if (!canListBranches && ownBranchFallback) return [ownBranchFallback];
  try {
    const all = await listBranches();
    return all.filter((b) => b.isActive);
  } catch (e) {
    if (ownBranchFallback && e instanceof ApiError && e.status === 403) return [ownBranchFallback];
    throw e;
  }
}
