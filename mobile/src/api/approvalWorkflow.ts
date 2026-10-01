import { useQuery } from "@tanstack/react-query";
import { apiRequestEnveloped as apiRequest } from "./client";
import { useAuth } from "../auth/AuthContext";

// Per-tenant approval workflow — mirrors backend/internal/workflow's
// Catalogue + GET /approval-workflow (any signed-in user). Each flow's
// stages are the business's own ordered approver roles; only a stage's role
// (or Administrator) may ACT at it (see canActAtStage). Mobile only reads
// this — the settings screen lives on the web.

export type FlowKey =
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

export function fetchApprovalWorkflow() {
  return apiRequest<FlowView[]>("/approval-workflow");
}

// --- Fallback defaults (backend workflow.Catalogue) -------------------------
// Used until the config has loaded, or if the fetch fails — so screens
// behave exactly as the backend does for a tenant that never changed a
// setting.

function st(key: string, pending: string, label: string, role: string, permission: string, module: string, on: boolean): StageView {
  return { key, pending, label, role, permission, module, defaultEnabled: on, enabled: on };
}

export const DEFAULT_WORKFLOW: WorkflowConfig = [
  {
    key: "loan_sanction",
    label: "Gold loan sanction",
    finalAction: "disburses",
    offBehavior: "At least one stage must stay on — the last enabled stage disburses the loan.",
    minEnabled: 1,
    stages: [
      st("LoanOperator", "LoanOperator", "Loan Operator", "Loan Operator", "can verify loan", "Loan Sanction", true),
      st("BranchManager", "BranchManager", "Branch Manager", "Branch Manager", "can approve branch manager stage", "Loan Sanction", true),
      st("FinalSanction", "FinalSanction", "Final Sanction", "Management", "can sanction loan", "Loan Sanction", true),
    ],
  },
  {
    key: "loan_extension",
    label: "Loan extension",
    finalAction: "extends",
    offBehavior: "The extension is applied as soon as the request is raised.",
    minEnabled: 0,
    stages: [
      st("LoanOfficer", "PendingLoanOfficer", "Loan Officer", "Loan Operator", "can verify the loan extension", "Loan Extension Approval", true),
      st("BranchManager", "PendingBranchManager", "Branch Manager", "Branch Manager", "can approve extension branch manager stage", "Loan Extension Approval", true),
      st("Management", "PendingManagement", "Management", "Management", "can approve extension management stage", "Loan Extension Approval", true),
    ],
  },
  {
    key: "loan_release",
    label: "Gold release",
    finalAction: "releases",
    offBehavior: "The release completes as soon as the checklist is done and the payment is recorded.",
    minEnabled: 0,
    stages: [
      st("Manager", "PendingManager", "Manager", "Branch Manager", "can approve release manager stage", "Release Approval", true),
      st("Management", "PendingManagement", "Management", "Management", "can approve release management stage", "Release Approval", true),
    ],
  },
  {
    key: "auction_partial_repayment",
    label: "Auction — partial repayment decision",
    finalAction: "decides",
    offBehavior: "The loan automatically stays in auction (Keep in Auction); no decision request is raised.",
    minEnabled: 0,
    stages: [st("Decision", "Pending", "Decision", "Branch Manager", "can decide auction partial repayment", "Auction Workflow", true)],
  },
  {
    key: "auction_shortfall",
    label: "Auction — shortfall decision",
    finalAction: "decides",
    offBehavior: "The balance is automatically pursued (loan moves to Overdue); a write-off is not possible.",
    minEnabled: 0,
    stages: [st("Decision", "Pending", "Decision", "Management", "can decide auction shortfall", "Auction Workflow", true)],
  },
  {
    key: "expense",
    label: "Expense",
    finalAction: "posts",
    offBehavior: "Expenses are recorded and posted to the ledger immediately.",
    minEnabled: 0,
    stages: [st("Approver", "Pending", "Approver", "Branch Manager", "can approve expense", "Expense Approval", false)],
  },
  {
    key: "loan_topup",
    label: "Loan top-up",
    finalAction: "disburses",
    offBehavior: "Top-ups are paid out immediately.",
    minEnabled: 0,
    stages: [
      st("BranchManager", "PendingBranchManager", "Branch Manager", "Branch Manager", "can approve top-up branch manager stage", "Top-Up Approval", false),
      st("Management", "PendingManagement", "Management", "Management", "can approve top-up management stage", "Top-Up Approval", false),
    ],
  },
  {
    key: "loan_waiver",
    label: "Waiver / adjustment",
    finalAction: "posts",
    offBehavior: "Waivers and adjustments are posted to the loan immediately.",
    minEnabled: 0,
    stages: [
      st("BranchManager", "PendingBranchManager", "Branch Manager", "Branch Manager", "can approve waiver branch manager stage", "Waiver Approval", true),
      st("Management", "PendingManagement", "Management", "Management", "can approve waiver management stage", "Waiver Approval", true),
    ],
  },
  {
    key: "personal_loan",
    label: "Personal loan",
    finalAction: "disburses",
    offBehavior: "Personal loans are created active and disbursed immediately.",
    minEnabled: 0,
    stages: [
      st("BranchManager", "PendingBranchManager", "Branch Manager", "Branch Manager", "can approve personal loan branch manager stage", "Personal Loan Approval", false),
      st("Management", "PendingManagement", "Management", "Management", "can approve personal loan management stage", "Personal Loan Approval", false),
    ],
  },
];

/** The tenant's approval workflow, fetched once per session and cached
 * (config changes rarely — a restart or 10 minutes picks up an edit). Always
 * returns a usable config: the catalogue defaults stand in while loading or
 * if the fetch fails. */
export function useApprovalWorkflow(): WorkflowConfig {
  const { employee } = useAuth();
  const q = useQuery({
    queryKey: ["approvalWorkflow", employee?.id ?? 0],
    queryFn: fetchApprovalWorkflow,
    enabled: !!employee,
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
  });
  return q.data && q.data.length ? q.data : DEFAULT_WORKFLOW;
}

// --- Helpers ----------------------------------------------------------------
// Each flow's chain is an ordered list of approver ROLES (set on the web's
// Roles & Permissions → Approval Workflow tab): a stage's key/pending is
// "R<roleId>", its label/role the role's name. An item still stored with a
// pre-chain value ("PendingBranchManager", …) maps onto the current chain
// exactly like backend workflow.Chain.resolve — see resolveIndex.

export function flowOf(config: WorkflowConfig, flow: string): FlowView | undefined {
  return config.find((f) => f.key === flow) ?? DEFAULT_WORKFLOW.find((f) => f.key === flow);
}

export function enabledStages(config: WorkflowConfig, flow: string): StageView[] {
  return (flowOf(config, flow)?.stages ?? []).filter((s) => s.enabled);
}

/** The chain an item walks: every role of the flow, in order. */
export function chainFor(config: WorkflowConfig, flow: string, _currentPending?: string | null): StageView[] {
  return enabledStages(config, flow);
}

/** Index in the chain of the stage an item stored with value v (its pending
 * value or stage key) waits at: an exact match; else a legacy value (its
 * flow's first legacy stage → the first step, any other → the step of the
 * same role); else, for a role key no longer in the chain, the first step.
 * -1 for no value, an empty chain, or a decided item ("Approved"/…). */
function resolveIndex(config: WorkflowConfig, flow: string, v?: string | null): number {
  const chain = enabledStages(config, flow);
  if (!v || chain.length === 0) return -1;
  const exact = chain.findIndex((s) => s.pending === v || s.key === v);
  if (exact >= 0) return exact;
  const legacy = DEFAULT_WORKFLOW.find((f) => f.key === flow)?.stages ?? [];
  const li = legacy.findIndex((s) => s.pending === v || s.key === v);
  if (li > 0) {
    const byRole = chain.findIndex((s) => s.role === legacy[li].role);
    if (byRole >= 0) return byRole;
  }
  return li >= 0 || /^R\d+$/.test(v) ? 0 : -1;
}

export function stageByPending(config: WorkflowConfig, flow: string, pending?: string | null): StageView | undefined {
  const i = resolveIndex(config, flow, pending);
  return i >= 0 ? enabledStages(config, flow)[i] : undefined;
}

export function stageByKey(config: WorkflowConfig, flow: string, key?: string | null): StageView | undefined {
  return stageByPending(config, flow, key);
}

/** True when `pending` is the LAST stage of the item's chain — the one whose
 * approval performs the flow's action (disburse / extend / release / post). */
export function isFinalStage(config: WorkflowConfig, flow: string, pending?: string | null): boolean {
  const i = resolveIndex(config, flow, pending);
  return i >= 0 && i === enabledStages(config, flow).length - 1;
}

/** A flow with no approver needs no approval at all. */
export function isFlowOff(config: WorkflowConfig, flow: string): boolean {
  return enabledStages(config, flow).length === 0;
}

/** Whether the signed-in employee (by role name) may act at stage: its own
 * role, or Administrator — mirrors backend workflow.Service.CanAct. Role
 * names are unique per business. A UX nicety; the server enforces it. */
export function canActAtStage(role: string | null | undefined, stage: StageView | null | undefined): boolean {
  if (!stage || !role) return false;
  return role === "Administrator" || role === stage.role;
}

/** Stepper labels for a chain: one per stage, the last one suffixed with the
 * flow's final action, e.g. "Management (disburses)". Empty = no stepper. */
export function stepperSteps(config: WorkflowConfig, flow: string, currentPending?: string | null): string[] {
  const chain = chainFor(config, flow, currentPending);
  const action = flowOf(config, flow)?.finalAction;
  return chain.map((s, i) => (i === chain.length - 1 && action ? `${s.label} (${action})` : s.label));
}

/** Index of the pending stage in its chain (for Stepper's `current`). */
export function stageIndex(config: WorkflowConfig, flow: string, pending?: string | null): number {
  return resolveIndex(config, flow, pending);
}
