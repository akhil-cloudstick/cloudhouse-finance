import { apiFetchEnveloped as apiFetch } from "@/product/services/httpClient";

/* Mirrors backend/internal/dashboard/model.go's NeedsAttentionItem exactly —
 * one row of the merged "Needs Attention" feed, discriminated by `kind`. */
export type NeedsAttentionItem =
  | { kind: "approval"; loanId: number; loanNumber: string; customerName: string; principal: number; approvalStage: string }
  | { kind: "request"; requestId: number; loanId: number; loanNumber: string; customerName: string; requestType: "Extension" | "Release"; detail: string }
  | { kind: "auction"; loanId: number; loanNumber: string; customerName: string; outstanding: number; status: string };

type BackendNeedsAttentionItem = {
  kind: "approval" | "request" | "auction";
  loanId?: number;
  loanNumber?: string;
  customerName?: string;
  principal?: number;
  approvalStage?: string;
  requestId?: number;
  requestType?: string;
  detail?: string;
  outstanding?: number;
  status?: string;
};

export type NeedsAttentionResult = {
  items: NeedsAttentionItem[];
  totalCount: number;
  approvalsCount: number;
  requestsCount: number;
  auctionsCount: number;
};

type BackendNeedsAttentionResult = {
  items: BackendNeedsAttentionItem[] | null;
  totalCount: number;
  approvalsCount: number;
  requestsCount: number;
  auctionsCount: number;
};

function toNeedsAttentionItem(r: BackendNeedsAttentionItem): NeedsAttentionItem {
  if (r.kind === "approval") {
    return {
      kind: "approval",
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
