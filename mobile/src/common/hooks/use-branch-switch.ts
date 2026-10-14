import { useAuth } from "@/common/providers/AuthProvider";
import { useTheme } from "@/common/theme/ThemeProvider";

// Branch visibility rules — the mobile counterpart of web's use-branch-switch.ts.
// A one-branch business (or plan) never shows a branch anywhere, and a role that
// can't see every branch is confined to its own, so there is nothing to pick.
// (The app has no global branch selector, so no branch is ever "selected".)

/** Whether to draw Branch columns, rows and form fields. */
export function useShowBranch(): boolean {
  const { can } = useAuth();
  const { singleBranch } = useTheme();
  return !singleBranch && can("Branch_Management", "can_view_all_branches");
}

/** Whether a list offers a Branch filter — only where there is more than one branch to pick between. */
export function useShowBranchFilter(): boolean {
  return useShowBranch();
}
