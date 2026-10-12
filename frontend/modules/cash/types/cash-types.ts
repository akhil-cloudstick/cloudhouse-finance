import type { LEDGER_MODES } from "@/modules/cash/services/cashService";

/* Shapes returned by the Go backend (backend/internal/cash/model.go). */
export type BackendCashMovement = {
  id: number;
  type: "in" | "out";
  source?: string;
  purpose?: string;
  // Mode of cash — "Cash" | "UPI" | "Bank Transfer" — required for type=in
  // via AddCashModal.tsx; blank for cash-out and every other movement that
  // doesn't record one (loan repayments, bank-pledge cash-in, …).
  mode?: string;
  bank?: string;
  // The linked bank's own record (backend preloads it) — its name is what the
  // ledger's Ref No column shows for bank-backed rows.
  bankRef?: { id: number; name: string };
  expenseId?: number | null;
  receiptImage?: string; // bill attached to this entry (/uploads/... URL)
  amount: number;
  status?: string;
  branchId?: number | null;
  branch?: { id: number; name: string };
  occurredOn: string;
  createdAt: string;
  // Party Transactions ledger fields — see backend/internal/cash/model.go's
  // CashMovement. transactionGroupId groups several rows from one split
  // payment (see SplitPaymentInput.tsx); bankId/partyCustomerId are the
  // real, queryable identities behind the free-text bank/customer this
  // movement is tied to (nullable — not every movement has either).
  transactionGroupId?: string;
  bankId?: number | null;
  // toBankId is the destination account for a bank-to-bank transfer — see
  // backend/internal/cash/model.go's CashMovement.ToBankID.
  toBankId?: number | null;
  // The other bank of a self transfer (see backend CashMovement.CounterBankID).
  counterBankId?: number | null;
  counterBankRef?: { id: number; name: string };
  partyCustomerId?: number | null;
  // loanSource is only present when source is "Loan" — see
  // backend/internal/cash/model.go's LoanCashSource.
  loanSource?: BackendLoanCashSource;
};
// Mirrors backend/internal/cash/model.go's LoanCashSource — the Loan
// Details block AddCashModal.tsx captures when Source of Cash is "Loan".
export type BackendLoanCashSource = {
  id: number;
  cashMovementId: number;
  bankId: number;
  bank?: { id: number; name: string };
  loanNumber: string;
  principalAmount: number;
  interestRate?: number | null;
  durationMonths?: number | null;
};
export type LoanSourceInput = {
  bankId: number;
  loanNumber: string;
  principalAmount: number;
  interestRate?: number;
  durationMonths?: number;
};
export type CashMovementView = {
  id: number;
  d: string;
  type: "in" | "out";
  source?: string;
  purpose?: string;
  mode?: string;
  bank?: string;
  bankName?: string;
  expenseId?: number | null;
  receiptImage?: string;
  amount: number;
  status?: string;
  branchId?: number | null;
  branchName?: string;
  transactionGroupId?: string;
  bankId?: number | null;
  toBankId?: number | null;
  counterBankId?: number | null;
  counterBankName?: string;
  partyCustomerId?: number | null;
  loanSource?: BackendLoanCashSource;
};
export type CashMovementInput = {
  type: "in" | "out";
  source?: string;
  purpose?: string;
  mode?: string;
  bank?: string;
  bankId?: number;
  toBankId?: number;
  amount: number;
  branchId?: number;
  occurredOn?: string; // "YYYY-MM-DD"
  loanSource?: LoanSourceInput;
  receiptImage?: string; // bill — /uploads/... URL, from uploadReceipt()
};
// Mirrors backend/internal/cash/repository.go's Category* constants —
// "" (CategoryAll) applies no filter. Kept as a plain string union rather
// than an enum so a stray unrecognized value just falls through to "no
// filter" server-side instead of a client-side type error.
export type CashMovementCategory = "" | "loan" | "auction" | "collection" | "expenses" | "personal loan" | "investment";
export type CashMovementFilters = {
  fromDate?: string;
  toDate?: string;
  category?: CashMovementCategory;
  // branchIds/customerIds/types are the Ledger filter panel's multi-select
  // Branch/Customer/Type sections — separate from the single `category`
  // above (kept for existing single-select callers, e.g. Cash.tsx's legacy
  // state) since a Type section can now have several buckets checked at
  // once.
  branchIds?: string[];
  customerIds?: string[];
  types?: CashMovementCategory[];
};
/* Bank-to-bank self transfer — the backend writes a debit row on the from
 * bank and a credit row on the to bank (see POST /cash-movements/self-transfer).
 * When `category` is a loan source the backend forces the to bank to the
 * loan's own bank, so toBankId is not needed then. */
export type SelfTransferInput = {
  category: string;
  amount: number;
  fromBankId: number;
  fromBank: string;
  toBankId?: number;
  toBank?: string;
  // How the money moved — shown on both rows. "Bank Transfer" when omitted.
  mode?: string;
  receiptImage?: string; // bill — /uploads/... URL
  branchId?: number;
  occurredOn: string;
};
/* Expense register. */
export type BackendExpense = {
  id: number;
  occurredOn: string;
  category: string;
  amount: number;
  mode: string;
  payee: string;
  // fromBankId/toBankId record an internal transfer between two of the
  // branch's own bank accounts when Mode is UPI/Bank — see
  // backend/internal/cash/model.go's Expense.FromBankID.
  fromBankId?: number | null;
  toBankId?: number | null;
  branchId: number;
  branch?: { id: number; name: string };
  status: "Pending" | "Approved" | "Rejected";
  // The approval-chain stage a Pending expense waits at (e.g. "R4"); empty
  // on rows from before the chain was configurable.
  approvalStage?: string;
  remarks?: string;
  approvedBy?: string;
  approvedAt?: string;
  receiptImage?: string;
  createdAt: string;
};
export type ExpenseView = {
  id: number;
  d: string;
  cat: string;
  amt: number;
  mode: string;
  payee: string;
  fromBankId?: number | null;
  toBankId?: number | null;
  branch: string;
  branchId: number;
  status: "Pending" | "Approved" | "Rejected";
  approvalStage?: string;
  remarks?: string;
  img?: string;
};
export type ExpenseFormInput = {
  category: string;
  amount: number;
  mode: string;
  payee?: string; // legacy — the form no longer asks for a description
  fromBankId?: number;
  toBankId?: number;
  branchId: number;
  occurredOn?: string; // "YYYY-MM-DD"
  remarks?: string;
  receiptImage?: string; // /uploads/... URL, from uploadReceipt()
};
/* Expected Cash in Hand summary — Opening + Collections - Disbursements - Cash Expenses.
 * Opening is carried forward: the previous day's closing Balance in Hand
 * (see cash.SummaryService.openingFor). */
/* Mirrors cash.CashInBreakdown / cash.CashOutBreakdown — the per-source split
 * of the day's `collections` / `disbursements` totals (see
 * cash.MovementRepository.SumBreakdownByDate). */
export type CashInBreakdown = {
  repayments: number;
  pledges: number;
  auctions: number;
  goldSales: number;
  topUps: number;
};
export type CashOutBreakdown = {
  loanDisbursements: number;
  bankReleases: number;
  auctionRefunds: number;
  goldPurchases: number;
  withdrawals: number;
};
export type CashSummary = {
  openingCash: number;
  openingCashSet: boolean;
  collections: number;
  disbursements: number;
  cashExpenses: number;
  expensesToday: number;
  expectedCash: number;
  // Live balances: physical cash in hand (Cash mode) and the combined balance
  // of every bank (UPI / Bank Transfer / Cheque) — no per-bank split.
  cashInHand: number;
  bankBalance: number;
  collectionsBreakdown: CashInBreakdown;
  disbursementsBreakdown: CashOutBreakdown;
};
/* Gold Sale — the business selling gold it owns (bought stock, NOT a
 * customer's pledged loan collateral — that's the Auction module instead).
 * Mirrors backend/internal/cash/model.go's GoldSale. Every sale also books a
 * matching cash-in movement (source "GoldSale"), so it's reflected in Cash-
 * in-Hand/Expected Cash automatically — no separate step needed here. */
export type BackendGoldSale = {
  id: number;
  ornamentType: string;
  soldAmount: number;
  costAmount: number;
  profit: number;
  soldOn: string;
  branchId: number;
  branch?: { id: number; name: string };
  mode?: string;
  bankId?: number | null;
  bankRef?: { id: number; name: string } | null;
  cashMovementId?: number | null;
  costCashMovementId?: number | null;
  remarks?: string;
  createdAt: string;
};
export type GoldSaleView = {
  id: number;
  d: string;
  ornamentType: string;
  soldAmount: number;
  costAmount: number;
  profit: number;
  branch: string;
  branchId: number;
  mode: string;
  bankId?: number;
  bankName?: string;
  remarks?: string;
};
export type GoldSaleInput = {
  ornamentType: string;
  soldAmount: number;
  costAmount: number;
  branchId: number;
  // Mode is how the sale proceeds were received — "Cash" | "UPI" | "Bank
  // Transfer" (see backend GoldSale.Mode's doc comment). Omit for Cash.
  mode?: string;
  // bankId is required when mode is UPI or Bank Transfer.
  bankId?: number;
  soldOn?: string; // "YYYY-MM-DD"
  remarks?: string;
  receiptImage?: string; // bill — /uploads/... URL
};
export type PartyTotals = {
  totalIn: number;
  totalOut: number;
  net: number;
  inCount: number;
  outCount: number;
};
// loanNumbers is the customer drilldown's Loan filter, now multi-select —
// loanNumber (singular) is kept for any caller still passing exactly one.
export type PartyDateRange = { fromDate?: string; toDate?: string; loanNumber?: string; loanNumbers?: string[]; modes?: string[] };
/* Combined ledger row shape returned by the customer/bank drill-down
 * endpoints (backend/internal/cash/ledger.go's LedgerRow) — a UNION of
 * CashMovement/LoanPayment/PersonalLoanPayment/GoldSale rows, not just plain
 * cash movements, so it's a distinct type from CashMovementView. Field names
 * mirror backend/internal/loan/service.go's LoanLedgerRow (the single-loan
 * ledger) so both can share one rendering component. */
export type LedgerRowView = {
  id: number;
  d: string;
  description: string;
  type: string;
  method: string;
  reference: string;
  debitOrCredit: "debit" | "credit";
  amount: number;
  runningBalance: number;
  bankId?: number | null;
  bankName?: string;
  customerId?: number;
  customerName?: string;
  receiptImage?: string; // bill attached to the entry behind this row
  memo?: boolean; // records how money was applied (an auction applied to a loan), not money moving
};
export type BackendLedgerRow = {
  id: number;
  date: string;
  description: string;
  type: string;
  method: string;
  reference: string;
  debitOrCredit: "debit" | "credit";
  amount: number;
  runningBalance: number;
  bankId?: number | null;
  bankName?: string;
  customerId?: number;
  customerName?: string;
  receiptImage?: string;
  memo?: boolean;
};
export type LedgerMode = (typeof LEDGER_MODES)[number];
