

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
/* The business's plan and how many active branches it runs — GET
 * /branches/quota. Advisory only: the server refuses an over-limit create or
 * reactivate on its own, whatever this page shows. quota 0 = unlimited. */
export type BranchQuota = {
  plan: string;
  quota: number;
  used: number;
  unlimited: boolean;
};
