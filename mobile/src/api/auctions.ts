import { apiRequest } from "./client";
import { AuctionRecord } from "../types/auction";

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

export function settleAuction(loanId: number, settlementStatus: string) {
  return apiRequest<AuctionRecord>(`/loans/${loanId}/auction/settle`, {
    method: "POST",
    body: { settlementStatus },
  });
}

// Backs the Auctions screen's History tab — mirrors
// frontend/lib/loansApi.ts's listConcludedAuctionsPage. hasSale=true is
// "Auctions Conducted" (a sale was recorded), hasSale=false is "Closed
// Without Auction" (Withdrawn before a sale) — two independently paginated
// tables, same as web.
export function listConcludedAuctions(params: { hasSale: boolean; limit: number; offset: number }) {
  return apiRequest<{ items: AuctionRecord[]; hasMore: boolean }>("/loans/auctions/concluded", { params });
}
