import { BankPledgeRecord } from "@/modules/loans/types/loan-types";

// History rows (GET /loans/bank-pledges/history) are joined with the loan's
// number and customer name so they can be listed without the parent loan.
export type BankPledgeHistoryRow = BankPledgeRecordWithWeights & { loanNumber?: string; customerName?: string };
// Weight fields the backend sends on every pledge record but src/modules/loans/types/loan-types.ts's
// BankPledgeRecord doesn't declare yet.
export type BankPledgeRecordWithWeights = BankPledgeRecord & {
  pledgedGrossWeight?: number;
  pledgedNetWeight?: number;
};
// items can come back null (Go nil slice) for an empty page.
export type Page<T> = { items: T[] | null; hasMore: boolean; total?: number };
