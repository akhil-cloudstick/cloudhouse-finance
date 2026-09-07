/* The branch switcher — Step 6 of the multi-tenancy plan.
 *
 * Administrator has always seen every branch. Management previously did not:
 * the backend's only cross-branch role was Administrator, so Management was
 * confined to its own branch like a Cashier. The backend now also treats
 * Management as cross-branch (platform.crossBranchRoles) and reads the
 * selected branch from the X-Branch-Id header (platform.SelectedBranchHeader)
 * — this module is the frontend half: where the selection lives, and how it
 * gets onto every request.
 *
 * Session-scoped, not persisted to localStorage. A branch selection is a
 * lens on the current sign-in, not a durable preference — logging in fresh
 * (a shared machine, a different manager) should start at "all branches",
 * not silently reopen whatever the last person was looking at.
 *
 * Keyed per business slug for the same reason tenantSession keys the JWT:
 * two businesses signed in in two tabs must not share a selected branch.
 */
import { activeBusinessSlug } from "@/common/services/tenantSession";

function storageKey(slug?: string | null): string {
  const s = slug === undefined ? activeBusinessSlug() : slug;
  return `ambikagold_selected_branch::${s || "default"}`;
}

/* The header name the backend reads — kept as one constant so a rename on
 * either side is a one-line diff, not a silent mismatch. Mirrors
 * platform.SelectedBranchHeader. */
export const SELECTED_BRANCH_HEADER = "X-Branch-Id";

export function getSelectedBranchId(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(storageKey());
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function setSelectedBranchId(id: number | null): void {
  if (typeof window === "undefined") return;
  const key = storageKey();
  if (id && id > 0) {
    window.sessionStorage.setItem(key, String(id));
  } else {
    window.sessionStorage.removeItem(key);
  }
  window.dispatchEvent(new Event("branch-selection-changed"));
}

export function clearSelectedBranch(slug?: string | null): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(storageKey(slug));
}

/* The header to merge into every authenticated request — empty object when
 * nothing is selected, so callers can always spread it unconditionally
 * ({...authHeader(), ...branchHeader()}) without an `if`. */
export function branchHeader(): Record<string, string> {
  const id = getSelectedBranchId();
  return id ? { [SELECTED_BRANCH_HEADER]: String(id) } : {};
}
