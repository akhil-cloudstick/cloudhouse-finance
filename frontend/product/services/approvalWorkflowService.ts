import { apiFetchEnveloped as apiFetch } from "@/product/services/httpClient";

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
  | "loan_waiver"
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
type LegacyStage = { key: string; pending: string; role: string };
const LEGACY: Record<string, LegacyStage[]> = {
  loan_sanction: [
    { key: "LoanOperator", pending: "LoanOperator", role: "Loan Operator" },
    { key: "BranchManager", pending: "BranchManager", role: "Branch Manager" },
    { key: "FinalSanction", pending: "FinalSanction", role: "Management" },
  ],
  loan_extension: [
    { key: "LoanOfficer", pending: "PendingLoanOfficer", role: "Loan Operator" },
    { key: "BranchManager", pending: "PendingBranchManager", role: "Branch Manager" },
    { key: "Management", pending: "PendingManagement", role: "Management" },
  ],
  loan_release: [
    { key: "Manager", pending: "PendingManager", role: "Branch Manager" },
    { key: "Management", pending: "PendingManagement", role: "Management" },
  ],
  loan_topup: [
    { key: "BranchManager", pending: "PendingBranchManager", role: "Branch Manager" },
    { key: "Management", pending: "PendingManagement", role: "Management" },
  ],
  loan_waiver: [
    { key: "BranchManager", pending: "PendingBranchManager", role: "Branch Manager" },
    { key: "Management", pending: "PendingManagement", role: "Management" },
  ],
  personal_loan: [
    { key: "BranchManager", pending: "PendingBranchManager", role: "Branch Manager" },
    { key: "Management", pending: "PendingManagement", role: "Management" },
  ],
  auction_partial_repayment: [{ key: "Decision", pending: "Pending", role: "Branch Manager" }],
  auction_shortfall: [{ key: "Decision", pending: "Pending", role: "Management" }],
  expense: [{ key: "Approver", pending: "Pending", role: "Branch Manager" }],
};

function flowMeta(
  key: ApprovalFlowKey, label: string, actionLabel: string, category: string, finalAction: string,
  offBehavior: string, defaultRoles: string[], minEnabled = 0, maxSteps = 0,
): FlowView {
  const stages = (LEGACY[key] || [])
    .filter((s) => defaultRoles.includes(s.role))
    .map((s) => ({ key: s.key, pending: s.pending, label: s.role, role: s.role, roleId: 0, permission: "", module: label, defaultEnabled: true, enabled: true }));
  return { key, label, actionLabel, category, finalAction, offBehavior, minEnabled, maxSteps, stages };
}

/* Fallback used until GET /approval-workflow answers, or if it fails — the
 * legacy default chains. Keep in step with backend/internal/workflow/
 * catalogue.go. */
export const DEFAULT_APPROVAL_WORKFLOW: ApprovalWorkflowConfig = [
  flowMeta("loan_sanction", "Gold loan sanction", "Sanction", "gold_loan", "disburses",
    "At least one approver is required — the last approver disburses the loan.", ["Loan Operator", "Branch Manager", "Management"], 1),
  flowMeta("loan_extension", "Loan extension", "Extension", "gold_loan", "extends",
    "The extension is applied as soon as the request is raised.", ["Loan Operator", "Branch Manager", "Management"]),
  flowMeta("loan_release", "Gold release", "Release", "gold_loan", "releases",
    "The release completes as soon as the checklist is done and the payment is recorded.", ["Branch Manager", "Management"]),
  flowMeta("loan_topup", "Loan top-up", "Top-up", "gold_loan", "disburses", "Top-ups are paid out immediately.", []),
  flowMeta("loan_waiver", "Waiver / adjustment", "Waiver / adjustment", "gold_loan", "posts",
    "Waivers and adjustments are posted to the loan immediately.", ["Branch Manager", "Management"]),
  flowMeta("personal_loan", "Personal loan", "Sanction", "personal_loan", "disburses",
    "Personal loans are created active and disbursed immediately.", []),
  flowMeta("auction_partial_repayment", "Auction — partial repayment decision", "Partial repayment", "auction", "decides",
    "The loan automatically stays in auction (Keep in Auction); no decision request is raised.", ["Branch Manager"], 0, 1),
  flowMeta("auction_shortfall", "Auction — shortfall decision", "Shortfall", "auction", "decides",
    "The balance is automatically pursued (loan moves to Overdue); a write-off is not possible.", ["Management"], 0, 1),
  flowMeta("expense", "Expense", "Approval", "expense", "posts", "Expenses are recorded and posted to the ledger immediately.", []),
];

export async function fetchApprovalWorkflow(): Promise<ApprovalWorkflowConfig> {
  return (await apiFetch<ApprovalWorkflowConfig>("/approval-workflow")) || [];
}

export async function fetchApprovalCategories(): Promise<CategoryView[]> {
  return (await apiFetch<CategoryView[]>("/approval-workflow/categories")) || [];
}

/* Saves one category: its mode and, for shared, the one chain (steps) or,
 * for per-action, each flow's chain (flows). Role IDs in approval order.
 * The backend refuses (400) a chain that breaks a flow's min/max. */
export function updateApprovalCategory(category: string, body: UpdateCategoryInput): Promise<CategoryView> {
  return apiFetch<CategoryView>(`/approval-workflow/categories/${category}`, {
    method: "PUT",
    body: JSON.stringify(body),
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

/* Index in the chain of the stage an item stored with value v waits at —
 * mirrors workflow.Chain.resolve: an exact match; else a legacy value (its
 * flow's first legacy stage → the first step, any other → the step of the
 * same role); else, for a role key no longer in the chain, the first step.
 * -1 for an empty chain, no value, or a decided item ("Approved"/…). */
function resolveIndex(stages: StageView[], flow: string, v: string, field: "key" | "pending"): number {
  if (!v || stages.length === 0) return -1;
  const exact = stages.findIndex((s) => s[field] === v);
  if (exact >= 0) return exact;
  const legacy = LEGACY[flow] || [];
  const li = legacy.findIndex((s) => s[field] === v);
  if (li > 0) {
    const byRole = stages.findIndex((s) => s.role === legacy[li].role);
    if (byRole >= 0) return byRole;
  }
  // Only a legacy value or a role key ("R<id>") whose role has left the
  // chain waits at the first step. Anything else — "Approved", "Rejected" —
  // is not waiting anywhere.
  return li >= 0 || /^R\d+$/.test(v) ? 0 : -1;
}

export function stageByPending(config: ApprovalWorkflowConfig, flow: ApprovalFlowKey | string, pending: string | null | undefined): StageView | null {
  const stages = enabledStages(config, flow);
  const i = resolveIndex(stages, flow, normalizePending(flow, pending || ""), "pending");
  return i >= 0 ? stages[i] : null;
}

export function stageByKey(config: ApprovalWorkflowConfig, flow: ApprovalFlowKey | string, key: string | null | undefined): StageView | null {
  const stages = enabledStages(config, flow);
  const i = resolveIndex(stages, flow, key || "", "key");
  return i >= 0 ? stages[i] : null;
}

/* The stage after stageKey — mirrors workflow.Chain.Next. */
export function nextStage(config: ApprovalWorkflowConfig, flow: ApprovalFlowKey | string, stageKey: string): StageView | null {
  const stages = enabledStages(config, flow);
  const i = resolveIndex(stages, flow, stageKey, "key");
  return i >= 0 ? stages[i + 1] ?? null : null;
}

/* Whether acting at stageKey runs the flow's real action (disburse, extend,
 * release, post) — mirrors workflow.Chain.IsFinal. */
export function isFinalStage(config: ApprovalWorkflowConfig, flow: ApprovalFlowKey | string, stageKey: string): boolean {
  return nextStage(config, flow, stageKey) === null;
}

export function firstStage(config: ApprovalWorkflowConfig, flow: ApprovalFlowKey | string): StageView | null {
  return enabledStages(config, flow)[0] ?? null;
}

/* The chain a tracker draws: every role of the flow, in order. The item's
 * current stage always resolves onto one of them (see stageByPending), so
 * the current-pending argument older callers pass is no longer needed. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function chainFor(config: ApprovalWorkflowConfig, flow: ApprovalFlowKey | string, _currentPending?: string | null): StageView[] {
  return enabledStages(config, flow);
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

/* Whether the signed-in user may act at stage s: its own role, or
 * Administrator — mirrors workflow.Service.CanAct. Role names are unique per
 * business. A UX nicety only; the server enforces it regardless. */
export function canActAtStage(actor: { role: string | null; isAdmin: boolean }, s: StageView | null | undefined): boolean {
  if (!s) return false;
  return actor.isAdmin || (!!actor.role && actor.role === s.role);
}
