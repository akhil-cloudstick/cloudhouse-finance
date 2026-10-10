

// Mirrors backend/internal/dashboard/snapshot_model.go's Snapshot — one
// day's captured KPI counts, used to compute the mobile dashboard's
// vs-yesterday trend indicators.
export type DashboardSnapshot = {
  id: number;
  date: string;
  activeCount: number;
  overdueCount: number;
  pendingApprovalCount: number;
  openedTodayCount: number;
  dueTodayCount: number;
  createdAt: string;
};
// ---- Staff dashboard (prototype redesign) ----------------------------------
// GET /dashboard/summary — every figure the hero header + "Today" card +
// 7-day cash-flow chart need, computed server-side (branch-scoped), so the
// phone never downloads full lists to count them.
export type DashboardSummary = {
  cashInHand: number;
  rate22k: number;
  rate24k: number;
  rateChangePct: number | null;
  today: { loansIssued: number; collections: number; newCustomers: number };
  cashFlow7d: { date: string; net: number }[];
};
// GET /dashboard/activity?limit&offset — merged recent activity feed, paged.
export type DashboardActivity = {
  type: string;
  label: string;
  customerName: string;
  customerCode?: string;
  loanNumber?: string;
  loanId?: number;
  amount: number;
  date: string;
};
export type NeedsAttentionKind = "approvals" | "requests" | "auctions";
export type NeedsAttentionItem = {
  kind: "approval" | "request" | "auction";
  loanId?: number;
  loanNumber?: string;
  customerName?: string;
  customerCode?: string;
  principal?: number;
  approvalStage?: string;
  // Approval items only: which workflow flow ("loan_sanction" |
  // "loan_topup" | "personal_loan" | "expense") and that item's own id (the
  // top-up / personal loan / expense). loanId stays the gold loan's.
  flow?: string;
  entityId?: number;
  requestId?: number;
  requestType?: string;
  detail?: string;
  outstanding?: number;
  status?: string;
};
export type NeedsAttentionPage = {
  items: NeedsAttentionItem[] | null;
  hasMore: boolean;
  total: number;
  approvalsCount: number;
  requestsCount: number;
  auctionsCount: number;
};
