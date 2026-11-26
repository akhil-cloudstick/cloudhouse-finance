import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/common/providers/AuthProvider";
import { useTheme } from "@/common/theme/ThemeProvider";
import { listSwitchableBranches } from "@/modules/branches/services/branchService";
import { type Branch } from "@/modules/branches/types/branch-types";

// Branch visibility rules — the mobile counterpart of web's use-branch-switch.ts.
// A one-branch business (or plan) never shows a branch anywhere, and a role that
// can't see every branch is confined to its own, so there is nothing to pick.

/** Whether to draw Branch columns, rows and form fields. */
export function useShowBranch(): boolean {
  const { can } = useAuth();
  const { singleBranch } = useTheme();
  return !singleBranch && can("Branch_Management", "can_view_all_branches");
}

/** Whether a list offers its own Branch filter — only where there is more than one branch to pick between,
 * and not while the profile's branch dropdown already narrows the whole app to one (a per-page filter holding a
 * different branch would intersect to an empty list). */
export function useShowBranchFilter(): boolean {
  const { selectedBranchId } = useAuth();
  return useShowBranch() && selectedBranchId == null;
}

/** Query key of the switchable-branch list; a branch switch deliberately leaves it alone (AuthProvider). */
export const SWITCHABLE_BRANCHES_KEY = ["branches", "switchable"] as const;

export type BranchSwitch = {
  /** False until the backend confirms the user can switch and there are at least two branches. */
  visible: boolean;
  branches: Branch[];
  selectedBranchId: number | null;
  /** Name of the selected branch, or "All branches". */
  selectedName: string;
  select: (id: number | null) => void;
};

/** The profile sheet's branch dropdown. Administrator and Management see every branch ("All branches") and can
 * narrow the whole app to one; every other role is confined to its own branch, so there is nothing to switch.
 * Stays invisible (no loading state) until GET /branches/switchable confirms canSwitch with 2+ branches. */
export function useBranchSwitch(): BranchSwitch {
  const { selectedBranchId, setSelectedBranch, employee } = useAuth();
  const eligible = useShowBranch();
  const employeeId = employee?.id;
  // Cached so the dropdown is instant; the Profile sheet refetches it each time it opens, and a branch switch
  // leaves it alone.
  const q = useQuery({
    queryKey: [...SWITCHABLE_BRANCHES_KEY, employeeId],
    queryFn: async () => {
      const res = await listSwitchableBranches();
      // The backend's canSwitch wins over the app's own role guess — showing nothing is the safe direction.
      return res.canSwitch ? res.branches.filter((b) => b.isActive !== false) : [];
    },
    enabled: eligible && employeeId != null,
    staleTime: 60_000,
  });
  const branches: Branch[] = q.data ?? [];
  const visible = eligible && employeeId != null && branches.length >= 2;
  const selected = selectedBranchId != null ? branches.find((b) => b.id === selectedBranchId) : undefined;
  return {
    visible,
    branches: visible ? branches : [],
    selectedBranchId,
    selectedName: selected?.name ?? "All branches",
    select: setSelectedBranch,
  };
}
