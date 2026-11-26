import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import type { DashboardSnapshot, DashboardSummary, DashboardActivity, NeedsAttentionKind, NeedsAttentionItem, NeedsAttentionPage } from "@/modules/dashboard/types/dashboard-types";

// Most recently captured snapshot (typically "yesterday", since capture
// runs nightly) — null if none has been captured yet (e.g. the first day
// after this feature ships).
export function latestDashboardSnapshot() {
  return apiRequest<DashboardSnapshot | null>("/dashboard/snapshots/latest");
}

export function getDashboardSummary() {
  return apiRequest<DashboardSummary>("/dashboard/summary");
}

export function listDashboardActivityPage(params: { limit: number; offset: number; q?: string }) {
  return apiRequest<{ items: DashboardActivity[] | null; hasMore: boolean; total?: number }>("/dashboard/activity", { params });
}

// GET /dashboard/needs-attention — pending approvals / requests / auction
// cases, page-numbered server-side (fixed page size 15). `q` and `kind`
// filter on the server. Adapted to the offset/hasMore shape useServerList
// consumes.
export const NEEDS_ATTENTION_PAGE_SIZE = 15;

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
