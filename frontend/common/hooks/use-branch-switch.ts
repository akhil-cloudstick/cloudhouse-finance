"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/common/providers/AuthProvider";
import { useBranding } from "@/common/providers/BrandingProvider";
import { listSwitchableBranches } from "@/modules/branches/services/branchService";
import { type BranchView } from "@/modules/branches/types/branch-types";

// `visible` stays false until GET /branches/switchable confirms canSwitch with at least two branches.
export type BranchSwitch = {
  visible: boolean;
  branches: BranchView[];
  selectedBranchId: number | null;
  // Name of the selected branch, or "All branches" when nothing is selected.
  selectedName: string;
  select: (id: number | null) => void;
  // A branch-confined employee's own branch, shown in place of the switcher; "" otherwise.
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
        // If backend canSwitch and frontend role guess ever disagree, showing nothing is the safe direction.
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

// False while the global selector already scopes the app to one branch, to avoid a conflicting intersection.
export function useShowBranchFilter(): boolean {
  const { selectedBranchId, isCrossBranch } = useAuth();
  const { singleBranch } = useBranding();
  return !singleBranch && isCrossBranch && selectedBranchId == null;
}

// null means the picker is free (and required).
export function useLockedBranchId(): number | null {
  const { selectedBranchId } = useAuth();
  return selectedBranchId;
}

export function useShowBranch(): boolean {
  const { isCrossBranch } = useAuth();
  const { singleBranch } = useBranding();
  return !singleBranch && isCrossBranch;
}
