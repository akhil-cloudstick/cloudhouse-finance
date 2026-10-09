"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/product/providers/auth-context";
import { useBranding } from "@/product/providers/BrandingProvider";
import { listSwitchableBranches, type BranchView } from "@/product/pages/branches/services/branchService";

/* The global branch selector (account menu). Administrator and Management
 * see every branch of their business by default ("All branches") and can
 * narrow the whole app to one; every other role's scope is a property of
 * their employee record, not a choice, so there is nothing to switch.
 *
 * `visible` stays false (no loading state) until the backend's own
 * GET /branches/switchable confirms canSwitch and there are at least two
 * branches — a single-branch business, or a plan limited to one branch,
 * never sees the control. */
export type BranchSwitch = {
  visible: boolean;
  branches: BranchView[];
  selectedBranchId: number | null;
  // Name of the selected branch, or "All branches" when nothing is selected.
  selectedName: string;
  select: (id: number | null) => void;
  // A branch-confined employee's own branch on a multi-branch plan — shown in
  // the account menu in place of the switcher. "" for cross-branch roles and
  // single-branch plans (which show no branch at all).
  ownBranchName: string;
};

export function useBranchSwitch(): BranchSwitch {
  const { isCrossBranch: crossBranchRole, selectedBranchId, setSelectedBranch, employee } = useAuth();
  const { singleBranch } = useBranding();
  const eligible = crossBranchRole && !singleBranch;
  const [branches, setBranches] = useState<BranchView[]>([]);

  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    listSwitchableBranches()
      .then((res) => {
        // Trust the backend's canSwitch over the frontend's role guess —
        // if they ever disagree, showing nothing is the safe direction.
        if (!cancelled) setBranches(res.canSwitch ? res.branches : []);
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [eligible]);

  const visible = eligible && branches.length >= 2;
  const selected = selectedBranchId != null ? branches.find((b) => b.id === selectedBranchId) : undefined;
  return {
    visible,
    branches: visible ? branches : [],
    selectedBranchId,
    selectedName: selected?.name ?? "All branches",
    select: setSelectedBranch,
    ownBranchName: !crossBranchRole && !singleBranch ? employee?.branch?.name ?? "" : "",
  };
}

/* Whether a page should offer its own Branch filter. Not in single-branch
 * mode (nothing to filter), and not while the global selector already scopes
 * the app to one branch — the header narrows every list server-side, so a
 * per-page branch filter would be redundant at best and, if it held a
 * different branch, would intersect to an empty page. Pages also ignore any
 * persisted branch-filter value while this is false. */
export function useShowBranchFilter(): boolean {
  const { selectedBranchId, isCrossBranch } = useAuth();
  const { singleBranch } = useBranding();
  return !singleBranch && isCrossBranch && selectedBranchId == null;
}

/* The branch a create/edit form's branch picker is locked to, if any: the
 * globally selected branch. null = picker is free (and required). Forms that
 * already lock in single-branch mode treat this the same way. */
export function useLockedBranchId(): number | null {
  const { selectedBranchId } = useAuth();
  return selectedBranchId;
}

/* Whether the UI should show business branches at all. Hidden — every branch
 * picker, column, field and label — on a single-branch plan (Head Office only)
 * and for a branch-confined employee (everything they see and save is their
 * own branch). Writes still carry that branch's id internally, and the backend
 * forces it either way. Only Administrator/Management on a multi-branch plan
 * see branches. */
export function useShowBranch(): boolean {
  const { isCrossBranch } = useAuth();
  const { singleBranch } = useBranding();
  return !singleBranch && isCrossBranch;
}
