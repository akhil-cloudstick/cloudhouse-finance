import { apiRequestEnveloped as apiRequest } from "./client";

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

// Most recently captured snapshot (typically "yesterday", since capture
// runs nightly) — null if none has been captured yet (e.g. the first day
// after this feature ships).
export function latestDashboardSnapshot() {
  return apiRequest<DashboardSnapshot | null>("/dashboard/snapshots/latest");
}

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

export function getDashboardSummary() {
  return apiRequest<DashboardSummary>("/dashboard/summary");
}

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

export function listDashboardActivityPage(params: { limit: number; offset: number; q?: string }) {
  return apiRequest<{ items: DashboardActivity[] | null; hasMore: boolean; total?: number }>("/dashboard/activity", { params });
}

// GET /dashboard/needs-attention — pending approvals / requests / auction
// cases, page-numbered server-side (fixed page size 15). `q` and `kind`
// filter on the server. Adapted to the offset/hasMore shape useServerList
// consumes.
export const NEEDS_ATTENTION_PAGE_SIZE = 15;
export type NeedsAttentionKind = "approvals" | "requests" | "auctions";
export type NeedsAttentionItem = {
  kind: "approval" | "request" | "auction";
  loanId?: number;
  loanNumber?: string;
  customerName?: string;
  customerCode?: string;
  principal?: number;
  approvalStage?: string;
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

export async function listNeedsAttentionPage(params: { offset: number; limit: number; q?: string; kind?: NeedsAttentionKind }): Promise<NeedsAttentionPage> {
  const page = Math.floor(params.offset / NEEDS_ATTENTION_PAGE_SIZE) + 1;
  const rec = await apiRequest<{
    items: NeedsAttentionItem[] | null;
    totalCount: number;
    approvalsCount: number;
    requestsCount: number;
    auctionsCount: number;
  }>("/dashboard/needs-attention", { params: { page, q: params.q, kind: params.kind } });
  return {
    items: rec.items ?? [],
    hasMore: page * NEEDS_ATTENTION_PAGE_SIZE < rec.totalCount,
    total: rec.totalCount,
    approvalsCount: rec.approvalsCount,
    requestsCount: rec.requestsCount,
    auctionsCount: rec.auctionsCount,
  };
}
