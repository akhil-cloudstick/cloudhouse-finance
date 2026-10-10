// Mirrors backend/internal/loan's AuctionRecord/AuctionNotice/
// AuctionDecisionRequest JSON shapes — same fields
// frontend/modules/loans/services/loanService.ts's AuctionRecordView /
// AuctionDecisionRequestView expose, kept in sync here.
export type AuctionNotice = {
  id: number;
  auctionRecordId: number;
  issuedAt: string;
  method: string;
  remarks?: string;
  createdAt: string;
};

// "Withdrawn" is a second terminal stage alongside "Settled" — reached when
// management pulls a case out after the customer caught up on payments (see
// AuctionDecisionKind's "PartialRepayment" -> "RemovedFromAuction" below).
export type AuctionStage =
  | "AuctionEligible"
  | "NoticeIssued"
  | "AuctionScheduled"
  | "Auctioned"
  | "Settled"
  | "Withdrawn";

export type AuctionSettlementStatus =
  | "Pending"
  | "SettledByRepayment"
  | "WrittenOff"
  | "SettledToCustomer"
  | "SettledToLoanCo";

export const AUCTION_OUTCOME_LABELS: Record<AuctionSettlementStatus, string> = {
  Pending: "Awaiting settlement",
  SettledByRepayment: "Settled by repayment",
  WrittenOff: "Closed — written off",
  SettledToCustomer: "Settled — surplus refunded",
  SettledToLoanCo: "Settled — surplus retained",
};

export type AuctionSurplusDisposition = "RefundedToCustomer" | "RecordedAsIncome";

// AuctionDecisionRequest is an escalation raised by the SYSTEM — never by
// staff — that freezes the auction pipeline until a human rules on it:
//  - PartialRepayment: the customer paid while their gold was in the
//    pipeline. Either Auction Administrator or Branch Manager may decide.
//  - Shortfall: the sale did not cover the debt. Only Branch Manager/
//    Management/Administrator may decide (enforced server-side too).
export type AuctionDecisionKind = "PartialRepayment" | "Shortfall";
export type AuctionDecisionStatus =
  | "Pending"
  | "KeepInAuction"
  | "RemovedFromAuction"
  | "WriteOff"
  | "PursueBalance";

export type AuctionDecisionRequest = {
  id: number;
  auctionRecordId: number;
  loanId: number;
  kind: AuctionDecisionKind;
  amountPaid: number;
  outstandingAtRequest: number;
  status: AuctionDecisionStatus;
  decidedByRole?: string;
  decisionRemarks?: string;
  createdAt: string;
  decidedAt?: string | null;
};

export type AuctionRecord = {
  id: number;
  loanId: number;
  stage: AuctionStage;
  auctionEligibleDate?: string;
  auctionDate?: string;
  auctionReferenceNumber?: string;
  saleAmount?: number;
  auctionExpenses?: number;
  surplusShortfall?: number;
  // Money owed BACK to the customer when the sale fetched more than the
  // debt — see hasUndisposedSurplus below. Empty/0 until a sale is recorded.
  surplusPayableAmount?: number;
  surplusDisposition?: AuctionSurplusDisposition | "";
  finalSettlementStatus?: AuctionSettlementStatus;
  notices?: AuctionNotice[];
  // Embedded on GET /loans/:id/auction (see backend's preloadAuctionDetail)
  // — no separate call needed to find an escalation frozen against THIS
  // loan's case, unlike the branch-wide /auctions/decisions/pending list.
  decisionRequests?: AuctionDecisionRequest[];
  createdAt: string;
  updatedAt: string;
};

// ConcludedAuctionRow is what GET /loans/auctions/concluded actually
// returns — an AuctionRecord plus its parent loan's number and customer's
// name (see backend's ConcludedAuctionRow), needed to identify/link a row
// instead of a bare numeric loanId.
export type ConcludedAuctionRow = AuctionRecord & { loanNumber: string; customerName: string };

export function pendingDecision(rec: AuctionRecord | null | undefined): AuctionDecisionRequest | null {
  return rec?.decisionRequests?.find((d) => d.status === "Pending") ?? null;
}

export function hasUndisposedSurplus(rec: AuctionRecord | null | undefined): boolean {
  return !!rec && (rec.surplusPayableAmount ?? 0) > 0.01 && !rec.surplusDisposition;
}
