import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import {
  AuctionRecord,
  AuctionDecisionRequest,
  AuctionDecisionStatus,
  AuctionSurplusDisposition,
  ConcludedAuctionRow,
} from "@/modules/auctions/types/auction-types";

// ?optional=1: the server answers 200 with null data (not a 404) when the
// loan has no auction case yet — null here means "no case".
export function getAuction(loanId: number) {
  return apiRequest<AuctionRecord | null>(`/loans/${loanId}/auction`, { params: { optional: 1 } }).then((r) => r ?? null);
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

// `payment` is how the proceeds were received — the split columns plus the branch bank account a
// UPI / Bank Transfer share landed in (web's recordAuctionSale sends the same).
export function recordAuctionSale(
  loanId: number,
  saleAmount: number,
  auctionExpenses?: number,
  payment?: { cashAmount: number; upiAmount: number; bankTransferAmount: number; bankId?: number }
) {
  return apiRequest<AuctionRecord>(`/loans/${loanId}/auction/sale`, {
    method: "POST",
    body: { saleAmount, auctionExpenses, ...(payment ?? {}) },
  });
}

// settleAuction disposes of a SURPLUS, not a generic settlement status — it
// is only reachable when the sale covered the debt in full (a shortfall
// raises a Shortfall decision instead, see resolveAuctionDecision below,
// and the backend rejects settling such a loan). Mirrors
// frontend/modules/loans/services/loanService.ts's settleAuction exactly;
// the backend still accepts the old "settlementStatus" field as a legacy
// alias, but this client always sends the current "disposition" shape.
// A "RefundedToCustomer" disposition also carries the one payment `mode` the refund was paid in and
// the bank it was paid from (none for Cash) — same as web.
export function settleAuction(loanId: number, disposition: AuctionSurplusDisposition, remarks?: string, mode?: string, bankId?: number) {
  return apiRequest<AuctionRecord>(`/loans/${loanId}/auction/settle`, {
    method: "POST",
    body: { disposition, remarks, mode, bankId },
  });
}

// Backs the Auctions screen's History tab — mirrors
// frontend/lib/loansApi.ts's listConcludedAuctionsPage. hasSale=true is
// "Auctions Conducted" (a sale was recorded), hasSale=false is "Closed
// Without Auction" (Withdrawn before a sale) — two independently paginated
// tables, same as web.
export function listConcludedAuctions(params: { hasSale: boolean; stage?: string; outcome?: string; limit: number; offset: number; q?: string }) {
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
// AuctionRecord.decisionRequests (see src/modules/auctions/types/auction-types.ts's pendingDecision).
// Kept here for a future "Decisions" list screen, matching the web app's
// GET /loans/auctions/decisions/pending.
export function listPendingAuctionDecisions() {
  return apiRequest<AuctionDecisionRequest[] | null>("/loans/auctions/decisions/pending");
}

/* Editing a concluded auction's sale. A dry run (nothing saved) answers with the effect on the loan and the
 * `dependents` — entries booked from the sale that the change leaves stale. Keys are spelled snake_case out and
 * camelCase in, as the web client does, since the contract adapter only renames the keys it knows. */
export type AuctionSaleCurrent = { saleAmount: number; auctionExpenses: number; saleDate: string; cashAmount: number; upiAmount: number; bankTransferAmount: number; bankId?: number | null };
export type AuctionDependent = { kind: string; id: number; description: string; current: string; suggested: string; required: boolean };
export type AuctionEditPreview = {
  before: { principal: number; interest: number; penalInterest: number; total: number; status: string };
  after: { principal: number; interest: number; penalInterest: number; total: number; status: string };
  dependents: AuctionDependent[];
};
export type EditAuctionSaleInput = { saleAmount: number; auctionExpenses: number; saleDate: string; cashAmount: number; upiAmount: number; bankTransferAmount: number; bankId?: number; applyDependents: { kind: string; id: number }[] };

const toSnake = (v: unknown): unknown => (Array.isArray(v) ? v.map(toSnake) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()), toSnake(x)])) : v);
const toCamel = <T>(v: unknown): T => (Array.isArray(v) ? v.map((x) => toCamel(x)) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase()), toCamel(x)])) : v) as T;

export function getAuctionSaleCurrent(loanId: number) {
  return apiRequest<unknown>(`/loans/${loanId}/auction/sale`).then((r) => toCamel<AuctionSaleCurrent>(r));
}

export function editAuctionSale(loanId: number, input: EditAuctionSaleInput, dryRun: boolean) {
  return apiRequest<unknown>(`/loans/${loanId}/auction/sale${dryRun ? "?dry_run=true" : ""}`, { method: "PATCH", body: toSnake(input) as Record<string, unknown> }).then((r) => toCamel<AuctionEditPreview>(r));
}
