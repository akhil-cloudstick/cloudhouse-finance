// Mirrors backend/internal/branch/model.go's Branch JSON tags exactly.
export type Branch = {
  id: number;
  name: string;
  code: string;
  address: string;
  phone: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

/** GET /branches/switchable — what the branch switcher offers. Not `listBranches`, which is itself branch-scoped:
 * once a branch is selected it would return only that one, leaving nothing to switch back to. canSwitch is the
 * backend's own decision (Administrator / Management). */
export type SwitchableBranches = { branches: Branch[]; canSwitch: boolean };

export type BranchInput = {
  name: string;
  code?: string;
  address: string;
  phone?: string;
  isActive?: boolean;
};
