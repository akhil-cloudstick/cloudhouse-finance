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
