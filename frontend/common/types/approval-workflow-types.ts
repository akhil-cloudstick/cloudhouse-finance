

/* Per-tenant approval-workflow configuration — mirrors backend/internal/
 * workflow's FlowView/StageView. Each flow's chain is an ordered list of
 * approver ROLES chosen on the Roles & Permissions → Approval Workflow tab;
 * a stage's key/pending value is "R<roleId>" and its label is the role
 * name. Only that role (or Administrator) may act at it.
 *
 * Semantics (backend workflow.Chain): an item starts at the first role,
 * approving moves it to the next, and the last role performs the flow's
 * real action (disburse/extend/release/post). An item still stored with a
 * pre-chain stage value ("PendingBranchManager", …) maps onto the current
 * chain — see resolveIndex. */

export type ApprovalFlowKey =
  | "loan_sanction"
  | "loan_extension"
  | "loan_release"
  | "auction_partial_repayment"
  | "auction_shortfall"
  | "expense"
  | "loan_topup"
  | "personal_loan";
export type StageView = {
  key: string;
  // The value stored on the item's approvalStage/status while it waits here.
  pending: string;
  label: string;
  role: string;
  roleId: number;
  permission: string;
  module: string;
  defaultEnabled: boolean;
  enabled: boolean;
};
export type FlowView = {
  key: string;
  label: string;
  actionLabel: string;
  category: string;
  finalAction: string;
  offBehavior: string;
  minEnabled: number;
  maxSteps: number;
  stages: StageView[];
};
export type ApprovalWorkflowConfig = FlowView[];
/* --- Admin screen (GET/PUT /approval-workflow/categories) --------------- */

export type ChainRole = { roleId: number; name: string; active: boolean };
export type CategoryFlow = {
  key: string;
  label: string;
  actionLabel: string;
  finalAction: string;
  offBehavior: string;
  minEnabled: number;
  maxSteps: number;
  steps: ChainRole[];
};
export type CategoryView = {
  key: string;
  label: string;
  description: string;
  shared: boolean;
  sharedSteps: ChainRole[];
  // Strictest of the category's flows — what a shared chain must satisfy.
  minEnabled: number;
  maxSteps: number;
  flows: CategoryFlow[];
};
export type UpdateCategoryInput = {
  shared: boolean;
  steps?: number[];
  flows?: Record<string, number[]>;
};
/* Legacy (pre-chain) stage values per flow, in their old order, with the
 * role each stood for — mirrors the Stages of workflow.Catalogue. Used only
 * to place an item still stored with one of them onto the current chain. */
export type LegacyStage = { key: string; pending: string; role: string };
