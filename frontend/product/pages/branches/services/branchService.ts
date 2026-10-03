import { apiFetchEnveloped, ApiError } from "@/product/services/httpClient";

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
  const rec = await apiFetchEnveloped<BranchView[]>("/branches");
  return rec || [];
}

/* Backs the branch switcher (GET /branches/switchable) — deliberately not
 * `listBranches` above, which is itself branch-scoped: once a selection is
 * active it would return just the one selected branch, leaving the switcher
 * unable to show anything to switch BACK to. See the backend handler's doc
 * comment (internal/branch/handler.go, Handler.Switchable). */
export type SwitchableBranches = {
  branches: BranchView[];
  // canSwitch mirrors the backend's decision (Administrator/Management),
  // independent of the frontend's own role check — kept in the response so
  // the two can never quietly disagree.
  canSwitch: boolean;
};

export async function listSwitchableBranches(): Promise<SwitchableBranches> {
  const rec = await apiFetchEnveloped<SwitchableBranches>("/branches/switchable");
  return rec || { branches: [], canSwitch: false };
}

/* The business's plan and how many active branches it runs — GET
 * /branches/quota. Advisory only: the server refuses an over-limit create or
 * reactivate on its own, whatever this page shows. quota 0 = unlimited. */
export type BranchQuota = {
  plan: string;
  quota: number;
  used: number;
  unlimited: boolean;
};

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
 * backend forces that on every write regardless. */
let ownBranchFallback: BranchView | null = null;
export function setOwnBranchFallback(branch: { id: number; name: string; code?: string } | null) {
  ownBranchFallback = branch
    ? { id: branch.id, name: branch.name, code: branch.code || "", address: "", phone: "", isActive: true }
    : null;
}

export async function listActiveBranches(): Promise<BranchView[]> {
  try {
    const all = await listBranches();
    return all.filter((b) => b.isActive);
  } catch (e) {
    if (ownBranchFallback && e instanceof ApiError && e.status === 403) return [ownBranchFallback];
    throw e;
  }
}
