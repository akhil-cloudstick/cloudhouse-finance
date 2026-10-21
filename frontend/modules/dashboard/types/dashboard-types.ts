

// approvalStage is the raw stored pending value; look up its label via stageLabel(config, flow, approvalStage).
export type NeedsAttentionApprovalFlow = "loan_sanction" | "loan_topup" | "personal_loan" | "expense";
export type NeedsAttentionItem =
  | { kind: "approval"; flow: NeedsAttentionApprovalFlow; entityId: number; loanId: number; loanNumber: string; customerName: string; principal: number; approvalStage: string; detail: string }
  | { kind: "request"; requestId: number; loanId: number; loanNumber: string; customerName: string; requestType: "Extension" | "Release"; detail: string }
  | { kind: "auction"; loanId: number; loanNumber: string; customerName: string; outstanding: number; status: string };
export type BackendNeedsAttentionItem = {
  kind: "approval" | "request" | "auction";
  flow?: string;
  entityId?: number;
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
export type BackendNeedsAttentionResult = {
  items: BackendNeedsAttentionItem[] | null;
  totalCount: number;
  approvalsCount: number;
  requestsCount: number;
  auctionsCount: number;
};
