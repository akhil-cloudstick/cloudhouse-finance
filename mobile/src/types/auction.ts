// Mirrors backend/internal/loan's AuctionRecord/AuctionNotice JSON shapes.
export type AuctionNotice = {
  id: number;
  auctionRecordId: number;
  issuedAt: string;
  method: string;
  remarks?: string;
  createdAt: string;
};

export type AuctionStage =
  | "AuctionEligible"
  | "NoticeIssued"
  | "AuctionScheduled"
  | "Auctioned"
  | "Settled";

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
  finalSettlementStatus?: "Pending" | "SettledToCustomer" | "SettledToLoanCo";
  notices?: AuctionNotice[];
  createdAt: string;
  updatedAt: string;
};
