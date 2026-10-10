import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import type { NeedsAttentionApprovalFlow, NeedsAttentionItem, BackendNeedsAttentionItem, NeedsAttentionResult, BackendNeedsAttentionResult } from "@/modules/dashboard/types/dashboard-types";

function toNeedsAttentionItem(r: BackendNeedsAttentionItem): NeedsAttentionItem {
  if (r.kind === "approval") {
    return {
      kind: "approval",
      flow: (r.flow as NeedsAttentionApprovalFlow) || "loan_sanction",
      entityId: r.entityId || r.loanId || 0,
      detail: r.detail || "",
      loanId: r.loanId || 0,
      loanNumber: r.loanNumber || "",
      customerName: r.customerName || "—",
      principal: r.principal || 0,
      approvalStage: r.approvalStage || "",
    };
  }
  if (r.kind === "request") {
    return {
      kind: "request",
      requestId: r.requestId || 0,
      loanId: r.loanId || 0,
      loanNumber: r.loanNumber || "",
      customerName: r.customerName || "—",
      requestType: (r.requestType as "Extension" | "Release") || "Extension",
      detail: r.detail || "",
    };
  }
  return {
    kind: "auction",
    loanId: r.loanId || 0,
    loanNumber: r.loanNumber || "",
    customerName: r.customerName || "—",
    outstanding: r.outstanding || 0,
    status: r.status || "",
  };
}

/* Backs Dashboard.tsx's "Needs Attention" card — real server-side
 * pagination (backend/internal/dashboard) over the merged pending-approval/
 * pending-request/auction-eligible rows, 15 per page (fixed server-side,
 * matching backend/internal/dashboard/service.go's NeedsAttentionPageSize). */
export async function getNeedsAttentionPage(page: number): Promise<NeedsAttentionResult> {
  const rec = await apiFetch<BackendNeedsAttentionResult>(`/dashboard/needs-attention?page=${page}`);
  return {
    items: (rec.items || []).map(toNeedsAttentionItem),
    totalCount: rec.totalCount,
    approvalsCount: rec.approvalsCount,
    requestsCount: rec.requestsCount,
    auctionsCount: rec.auctionsCount,
  };
}
