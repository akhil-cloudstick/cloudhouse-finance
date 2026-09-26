import { apiRequestEnveloped as apiRequest } from "./client";
import {
  AuctionRecord,
  AuctionDecisionRequest,
  AuctionDecisionStatus,
  AuctionSurplusDisposition,
  ConcludedAuctionRow,
} from "../types/auction";

export function getAuction(loanId: number) {
  return apiRequest<AuctionRecord>(`/loans/${loanId}/auction`);
}

export function markAuctionEligible(loanId: number) {
  return apiRequest<AuctionRecord>(`/loans/${loanId}/auction/eligible`, { method: "POST" });
}

export function issueAuctionNotice(loanId: number, remarks?: string) {
  return apiRequest<AuctionRecord>(`/loans/${loanId}/auction/notice`, { method: "POST", body: { remarks } });
}

export function scheduleAuction(loanId: number, auctionDate: string, referenceNumber?: string) {
  return apiRequest<AuctionRecord>(`/loans/${loanId}/auction/schedule`, {
    method: "POST",
    body: { auctionDate, referenceNumber },
  });
}

export function recordAuctionSale(loanId: number, saleAmount: number, auctionExpenses?: number) {
  return apiRequest<AuctionRecord>(`/loans/${loanId}/auction/sale`, {
    method: "POST",
    body: { saleAmount, auctionExpenses },
  });
}

// settleAuction disposes of a SURPLUS, not a generic settlement status — it
// is only reachable when the sale covered the debt in full (a shortfall
// raises a Shortfall decision instead, see resolveAuctionDecision below,
// and the backend rejects settling such a loan). Mirrors
// frontend/modules/loans/services/loanService.ts's settleAuction exactly;
// the backend still accepts the old "settlementStatus" field as a legacy
// alias, but this client always sends the current "disposition" shape.
export function settleAuction(loanId: number, disposition: AuctionSurplusDisposition, remarks?: string) {
  return apiRequest<AuctionRecord>(`/loans/${loanId}/auction/settle`, {
    method: "POST",
    body: { disposition, remarks },
  });
}

// Backs the Auctions screen's History tab — mirrors
// frontend/lib/loansApi.ts's listConcludedAuctionsPage. hasSale=true is
// "Auctions Conducted" (a sale was recorded), hasSale=false is "Closed
// Without Auction" (Withdrawn before a sale) — two independently paginated
// tables, same as web.
export function listConcludedAuctions(params: { hasSale: boolean; limit: number; offset: number; q?: string }) {
  return apiRequest<{ items: ConcludedAuctionRow[] | null; hasMore: boolean; total?: number }>("/loans/auctions/concluded", { params });
}

// resolveAuctionDecision applies a human ruling to an escalation the SYSTEM
// raised — staff never create these, so the pipeline stays frozen until
// someone answers. Valid `decision` values depend on the request's kind
// (PartialRepayment -> KeepInAuction|RemovedFromAuction, Shortfall ->
// PursueBalance|WriteOff); the backend enforces both that and the role
// authority (Shortfall needs Branch Manager/Management/Administrator).
export function resolveAuctionDecision(
  loanId: number,
  requestId: number,
  decision: Exclude<AuctionDecisionStatus, "Pending">,
  remarks?: string
) {
  return apiRequest<AuctionRecord>(`/loans/${loanId}/auction/decision`, {
    method: "POST",
    body: { requestId, decision, remarks },
  });
}

// listPendingAuctionDecisions is the branch-wide queue (every loan's open
// escalation at once) — not used by the loan detail screen, which instead
// reads the SAME loan's own pending decision straight off
// AuctionRecord.decisionRequests (see types/auction.ts's pendingDecision).
// Kept here for a future "Decisions" list screen, matching the web app's
// GET /loans/auctions/decisions/pending.
export function listPendingAuctionDecisions() {
  return apiRequest<AuctionDecisionRequest[] | null>("/loans/auctions/decisions/pending");
}
