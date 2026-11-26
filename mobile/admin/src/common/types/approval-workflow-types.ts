

// Per-tenant approval workflow — mirrors backend/internal/workflow's
// Catalogue + GET /approval-workflow (any signed-in user). Each flow's
// stages are the business's own ordered approver roles; only a stage's role
// (or the system account) may ACT at it (see canActAtStage). Mobile only reads
// this — the settings screen lives on the web.

export type FlowKey =
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
  // Value stored on the item's approvalStage/status while it waits here.
  pending: string;
  label: string;
  role: string;
  roleId?: number;
  permission: string;
  module: string;
  defaultEnabled: boolean;
  enabled: boolean;
};
export type FlowView = {
  key: FlowKey | string;
  label: string;
  finalAction: string;
  offBehavior: string;
  minEnabled: number;
  stages: StageView[];
};
export type WorkflowConfig = FlowView[];
// --- Admin screen (Roles & Permissions → Approval Workflow tab) -------------
// Mirrors backend workflow.CategoryView / UpdateCategoryInput and the web's
// approvalWorkflowService. Viewing needs "can view role and permission",
// saving "can update role" — the routes enforce both.

/** One approver in a chain: an active, non-system role of the business. */
export type ChainRole = { roleId: number; name: string; active: boolean };
export type CategoryFlowView = {
  key: string;
  label: string;
  actionLabel: string;
  finalAction: string;
  offBehavior: string;
  minEnabled: number;
  /** 0 = no limit. */
  maxSteps: number;
  steps: ChainRole[];
};
/** A group of flows (Gold Loan, Personal Loan, Auction, Expense). With
 * `shared` on, one chain (sharedSteps) serves every flow in it. */
export type CategoryView = {
  key: string;
  label: string;
  description: string;
  shared: boolean;
  sharedSteps: ChainRole[];
  minEnabled: number;
  maxSteps: number;
  flows: CategoryFlowView[];
};
export type UpdateCategoryInput = { shared: true; steps: number[] } | { shared: false; flows: Record<string, number[]> };
