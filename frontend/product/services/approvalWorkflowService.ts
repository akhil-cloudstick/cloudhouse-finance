import { apiFetchEnveloped as apiFetch } from "@/product/services/httpClient";

/* Per-tenant approval-workflow configuration — mirrors backend/internal/
 * workflow's FlowView/StageView. The stage list of every flow is fixed in
 * code (workflow.Catalogue); a business only switches individual stages on
 * or off. Who may act at a stage is still a role-permission grant — this
 * only says which stages exist for this business right now.
 *
 * Semantics (backend workflow.Chain): an item starts at the first ENABLED
 * stage, approving moves it to the next enabled stage, and the last enabled
 * stage performs the flow's real action (disburse/extend/release/post). An
 * item parked on a stage that has since been switched off can still be acted
 * on there, so trackers include the current stage even when disabled. */

export type ApprovalFlowKey =
  | "loan_sanction"
  | "loan_extension"
  | "loan_release"
  | "auction_partial_repayment"
  | "auction_shortfall"
  | "expense"
  | "loan_topup"
  | "loan_waiver"
  | "personal_loan";

export type StageView = {
  key: string;
  // The value stored on the item's approvalStage/status while it waits here.
  pending: string;
  label: string;
  role: string;
  permission: string;
  module: string;
  defaultEnabled: boolean;
  enabled: boolean;
};

export type FlowView = {
  key: string;
  label: string;
  finalAction: string;
  offBehavior: string;
  minEnabled: number;
  stages: StageView[];
};

export type ApprovalWorkflowConfig = FlowView[];

function stage(key: string, pending: string, label: string, role: string, permission: string, module: string, on: boolean): StageView {
  return { key, pending, label, role, permission, module, defaultEnabled: on, enabled: on };
}

/* Fallback used until GET /approval-workflow answers, or if it fails — a
 * copy of workflow.Catalogue with every stage at its default. Keep in step
 * with backend/internal/workflow/catalogue.go. */
export const DEFAULT_APPROVAL_WORKFLOW: ApprovalWorkflowConfig = [
  {
    key: "loan_sanction", label: "Gold loan sanction", finalAction: "disburses", minEnabled: 1,
    offBehavior: "At least one stage must stay on — the last enabled stage disburses the loan.",
    stages: [
      stage("LoanOperator", "LoanOperator", "Loan Operator", "Loan Operator", "can verify loan", "Loan Sanction", true),
      stage("BranchManager", "BranchManager", "Branch Manager", "Branch Manager", "can approve branch manager stage", "Loan Sanction", true),
      stage("FinalSanction", "FinalSanction", "Final Sanction", "Management", "can sanction loan", "Loan Sanction", true),
    ],
  },
  {
    key: "loan_extension", label: "Loan extension", finalAction: "extends", minEnabled: 0,
    offBehavior: "The extension is applied as soon as the request is raised.",
    stages: [
      stage("LoanOfficer", "PendingLoanOfficer", "Loan Officer", "Loan Operator", "can verify the loan extension", "Loan Extension Approval", true),
      stage("BranchManager", "PendingBranchManager", "Branch Manager", "Branch Manager", "can approve extension branch manager stage", "Loan Extension Approval", true),
      stage("Management", "PendingManagement", "Management", "Management", "can approve extension management stage", "Loan Extension Approval", true),
    ],
  },
  {
    key: "loan_release", label: "Gold release", finalAction: "releases", minEnabled: 0,
    offBehavior: "The release completes as soon as the checklist is done and the payment is recorded.",
    stages: [
      stage("Manager", "PendingManager", "Manager", "Branch Manager", "can approve release manager stage", "Release Approval", true),
      stage("Management", "PendingManagement", "Management", "Management", "can approve release management stage", "Release Approval", true),
    ],
  },
  {
    key: "auction_partial_repayment", label: "Auction — partial repayment decision", finalAction: "decides", minEnabled: 0,
    offBehavior: "The loan automatically stays in auction (Keep in Auction); no decision request is raised.",
    stages: [stage("Decision", "Pending", "Decision", "Branch Manager", "can decide auction partial repayment", "Auction Workflow", true)],
  },
  {
    key: "auction_shortfall", label: "Auction — shortfall decision", finalAction: "decides", minEnabled: 0,
    offBehavior: "The balance is automatically pursued (loan moves to Overdue); a write-off is not possible.",
    stages: [stage("Decision", "Pending", "Decision", "Management", "can decide auction shortfall", "Auction Workflow", true)],
  },
  {
    key: "expense", label: "Expense", finalAction: "posts", minEnabled: 0,
    offBehavior: "Expenses are recorded and posted to the ledger immediately.",
    stages: [stage("Approver", "Pending", "Approver", "Branch Manager", "can approve expense", "Expense Approval", false)],
  },
  {
    key: "loan_topup", label: "Loan top-up", finalAction: "disburses", minEnabled: 0,
    offBehavior: "Top-ups are paid out immediately.",
    stages: [
      stage("BranchManager", "PendingBranchManager", "Branch Manager", "Branch Manager", "can approve top-up branch manager stage", "Top-Up Approval", false),
      stage("Management", "PendingManagement", "Management", "Management", "can approve top-up management stage", "Top-Up Approval", false),
    ],
  },
  {
    key: "loan_waiver", label: "Waiver / adjustment", finalAction: "posts", minEnabled: 0,
    offBehavior: "Waivers and adjustments are posted to the loan immediately.",
    stages: [
      stage("BranchManager", "PendingBranchManager", "Branch Manager", "Branch Manager", "can approve waiver branch manager stage", "Waiver Approval", true),
      stage("Management", "PendingManagement", "Management", "Management", "can approve waiver management stage", "Waiver Approval", true),
    ],
  },
  {
    key: "personal_loan", label: "Personal loan", finalAction: "disburses", minEnabled: 0,
    offBehavior: "Personal loans are created active and disbursed immediately.",
    stages: [
      stage("BranchManager", "PendingBranchManager", "Branch Manager", "Branch Manager", "can approve personal loan branch manager stage", "Personal Loan Approval", false),
      stage("Management", "PendingManagement", "Management", "Management", "can approve personal loan management stage", "Personal Loan Approval", false),
    ],
  },
];

export async function fetchApprovalWorkflow(): Promise<ApprovalWorkflowConfig> {
  return (await apiFetch<ApprovalWorkflowConfig>("/approval-workflow")) || [];
}

/* stages maps stage key → enabled. The backend refuses (400) a loan_sanction
 * update that would leave no stage on. */
export function updateApprovalWorkflow(flow: ApprovalFlowKey | string, stages: Record<string, boolean>): Promise<FlowView> {
  return apiFetch<FlowView>(`/approval-workflow/${flow}`, {
    method: "PUT",
    body: JSON.stringify({ stages }),
  });
}

/* --- Lookups ------------------------------------------------------------
 * Every helper falls back to the catalogue default when the flow is missing
 * from `config` (e.g. an older backend), so callers never need a null check
 * on the flow itself. */

export function flowOf(config: ApprovalWorkflowConfig, flow: ApprovalFlowKey | string): FlowView | undefined {
  return config.find((f) => f.key === flow) ?? DEFAULT_APPROVAL_WORKFLOW.find((f) => f.key === flow);
}

export function enabledStages(config: ApprovalWorkflowConfig, flow: ApprovalFlowKey | string): StageView[] {
  return (flowOf(config, flow)?.stages || []).filter((s) => s.enabled);
}

export function isFlowOff(config: ApprovalWorkflowConfig, flow: ApprovalFlowKey | string): boolean {
  return enabledStages(config, flow).length === 0;
}

// A release request's approvalStage is "" until the first stage is reached
// explicitly — the backend reads that as PendingManager.
function normalizePending(flow: string, pending: string): string {
  if (flow === "loan_release" && !pending) return "PendingManager";
  // The retired 4th sanction checkpoint — the backend migrates rows off it.
  if (flow === "loan_sanction" && pending === "AuthorizedManagement") return "FinalSanction";
  return pending;
}

export function stageByPending(config: ApprovalWorkflowConfig, flow: ApprovalFlowKey | string, pending: string | null | undefined): StageView | null {
  const p = normalizePending(flow, pending || "");
  return flowOf(config, flow)?.stages.find((s) => s.pending === p) ?? null;
}

export function stageByKey(config: ApprovalWorkflowConfig, flow: ApprovalFlowKey | string, key: string | null | undefined): StageView | null {
  return flowOf(config, flow)?.stages.find((s) => s.key === key) ?? null;
}

/* The next ENABLED stage after stageKey in canonical order (stageKey itself
 * may be disabled) — mirrors workflow.Chain.Next. */
export function nextStage(config: ApprovalWorkflowConfig, flow: ApprovalFlowKey | string, stageKey: string): StageView | null {
  const stages = flowOf(config, flow)?.stages || [];
  const i = stages.findIndex((s) => s.key === stageKey);
  if (i < 0) return stages.find((s) => s.enabled) ?? null;
  return stages.slice(i + 1).find((s) => s.enabled) ?? null;
}

/* Whether acting at stageKey runs the flow's real action (disburse, extend,
 * release, post) — mirrors workflow.Chain.IsFinal. */
export function isFinalStage(config: ApprovalWorkflowConfig, flow: ApprovalFlowKey | string, stageKey: string): boolean {
  return nextStage(config, flow, stageKey) === null;
}

export function firstStage(config: ApprovalWorkflowConfig, flow: ApprovalFlowKey | string): StageView | null {
  return enabledStages(config, flow)[0] ?? null;
}

/* The chain a tracker draws: every enabled stage in order, plus the item's
 * current stage when it has since been switched off (it can still be acted
 * on there). */
export function chainFor(config: ApprovalWorkflowConfig, flow: ApprovalFlowKey | string, currentPending?: string | null): StageView[] {
  const current = currentPending !== undefined && currentPending !== null ? stageByPending(config, flow, currentPending) : null;
  return (flowOf(config, flow)?.stages || []).filter((s) => s.enabled || (current && s.key === current.key));
}

/* Tracker labels for a chain — the last step names what it does, e.g.
 * "Management (disburses)". */
export function trackerLabels(config: ApprovalWorkflowConfig, flow: ApprovalFlowKey | string, chain: StageView[]): string[] {
  const finalAction = flowOf(config, flow)?.finalAction;
  return chain.map((s, i) => (i === chain.length - 1 && finalAction ? `${s.label} (${finalAction})` : s.label));
}

/* Label for a stored pending value, falling back to the raw value. */
export function stageLabel(config: ApprovalWorkflowConfig, flow: ApprovalFlowKey | string, pending: string | null | undefined): string {
  return stageByPending(config, flow, pending)?.label ?? (pending || "—");
}

/* The underscored (module, key) pair `can()` expects for a stage's
 * permission — "Top-Up Approval"/"can approve top-up management stage" →
 * "Top-Up_Approval"/"can_approve_top-up_management_stage", the same
 * derivation the backend uses for the permission map. */
export function stagePermission(s: StageView): { module: string; key: string } {
  return { module: s.module.replace(/ /g, "_"), key: s.permission.replace(/ /g, "_") };
}

export function canActAtStage(can: (moduleKey: string, permissionKey: string) => boolean, s: StageView | null | undefined): boolean {
  if (!s) return false;
  const p = stagePermission(s);
  return can(p.module, p.key);
}
