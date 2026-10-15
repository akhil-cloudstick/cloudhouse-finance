import type { LEDGER_MODES } from "@/modules/cash/services/cashService";
// Mirrors backend/internal/cash's CashMovement/Expense JSON shapes.
export type CashMovement = {
  // Bill attached to this entry (/uploads/... URL) — see the ledger's "View bill".
  receiptImage?: string;
  id: number;
  type: "in" | "out";
  source: string;
  purpose: string;
  // Payment mode this specific movement was made in ("Cash"/"UPI"/"Bank
  // Transfer"/"Cheque") — a single loan payment split across modes books
  // one CashMovement row PER non-zero mode, sharing transactionGroupId
  // below, so this is what actually lets the ledger show the distribution
  // instead of one lump sum.
  mode?: string;
  bank?: string;
  amount: number;
  status?: string;
  branchId: number;
  branch?: { id: number; name: string };
  occurredOn: string;
  // Groups every CashMovement row produced by one split payment/
  // disbursement — see this field's own doc comment on `mode` above.
  transactionGroupId?: string;
  bankId?: number;
  bankRef?: { id: number; name: string };
  // Set on the cash-out row an approved expense booked (incl. loan repayments).
  expenseId?: number | null;
  partyCustomerId?: number;
  partyCustomer?: { id: number; name: string };
  // Remarks typed on a cash-in / debit / self transfer; shown in the info sheet.
  remarks?: string;
  // True for a cash-in / debit / self transfer a person keyed in — the ledger
  // shows the info icon and Edit on it.
  editable?: boolean;
  createdAt: string;
};

export type Expense = {
  id: number;
  occurredOn: string;
  category: string;
  amount: number;
  mode: string;
  payee?: string;
  branchId: number;
  branch?: { id: number; name: string };
  status: "Pending" | "Approved" | "Rejected";
  remarks?: string;
  approvedBy?: string;
  approvedAt?: string;
  receiptImage?: string;
  // A pending or approved expense a person keyed in — the list offers Edit on it.
  editable?: boolean;
  // The approval-chain stage a Pending expense waits at (empty on rows from before the chain was configurable).
  approvalStage?: string;
  createdAt: string;
};

export type CashSummary = {
  openingCash: number;
  collections: number;
  disbursements: number;
  cashExpenses: number;
  expectedCash: number;
  // Today's expenses (all modes) and the live balances: physical cash in hand (Cash mode) and the
  // combined balance of every bank (UPI / Bank Transfer / Cheque). Mirrors the web's CashSummary.
  expensesToday?: number;
  cashInHand?: number;
  bankBalance?: number;
};

// Mirrors backend/internal/cash's GoldSale JSON shape (model.go).
export type GoldSale = {
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
  remarks?: string;
  createdAt: string;
};

// LoanSource mirrors backend/internal/cash/handler.go's loanSourceRequest —
// the Loan Details block MovementSheet captures when Source is "Loan"
// (loanNumber/principalAmount required, interestRate/durationMonths
// optional). See backend/internal/cash/model.go's LoanCashSource.
export type LoanSourceInput = {
  loanNumber: string;
  principalAmount: number;
  interestRate?: number;
  durationMonths?: number;
};
// Cash sources — a small find-or-create lookup list (backend/internal/cash's
// CashSource) backing the Add Cash sheet's Source picker, real server-side
// pagination (matches web's cashSourceService.ts).
// type/isCommon: a search also returns categories of another form — picking
// one makes it common (find-or-create POST). A loan source carries its
// captured details (loanNumber/principalAmount) once on file.
export type CategoryType = "cash_in" | "expense" | "self_transfer";
export type CashSource = {
  id: number;
  name: string;
  createdAt: string;
  type?: CategoryType;
  isCommon?: boolean;
  loanNumber?: string;
  principalAmount?: number;
};
// Expense categories — same find-or-create/paginated pattern as cash
// sources, backing the Expense sheet's Category picker.
export type ExpenseCategory = { id: number; name: string; createdAt: string; type?: CategoryType; isCommon?: boolean; principalAmount?: number };
// Unified categories (GET /categories?type=) — the Self Transfer picker's
// list: its own plus every common one. Same shape as a cash source.
export type Category = CashSource;
// One row of any combined ledger (bank / customer / mode / expense category)
// — backend/internal/cash/ledger.go's LedgerRow, same shape the web
// PartyLedger.tsx/ModeLedgerPage.tsx render. runningBalance is computed
// server-side across the whole ledger, not just the loaded page.
export type LedgerRow = {
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
  receiptImage?: string; // bill attached to the entry behind this row
  memo?: boolean; // records how money was applied (an auction applied to a loan), not money moving
  // The cash movement behind a cash-in / debit / self-transfer row — the info
  // sheet and Edit open it. Absent on every other row.
  entryId?: number;
  editable?: boolean;
};
// One line of a payment breakdown: how much was paid in which mode (and
// through which bank for UPI / Bank Transfer). Each line of a Credit or Debit
// entry becomes its own ledger entry; together they add up to the amount.
export type PaymentPart = { mode: string; amount: number; bankId?: number };
// The info sheet / Edit data for a cash-in, debit or self transfer
// (GET/PUT /cash-movements/:id/entry — backend entry.go).
export type EntryKind = "cash_in" | "debit" | "self_transfer" | "gold_sale" | "system";
export type EntryLine = { movementId: number; mode: string; amount: number; bankId?: number | null; bankName?: string };
export type EntryInfo = {
  kind: EntryKind;
  // True when opened from the Expenses list — saving then goes through PUT /expenses/:id.
  viaExpense?: boolean;
  editable: boolean;
  movementId: number;
  category: string;
  amount: number;
  occurredOn: string;
  recordedAt: string;
  remarks: string;
  branchId?: number | null;
  branchName: string;
  receiptImage?: string;
  lines: EntryLine[];
  fromBankId?: number | null;
  fromBank?: string;
  toBankId?: number | null;
  toBank?: string;
  status?: string;
  approvedBy?: string;
  approvedAt?: string;
  // A gold sale's ornament and what it cost.
  ornamentType?: string;
  costAmount?: number;
  // A draw on a loan: the loan's number and its principal.
  loanNumber?: string;
  principalAmount?: number;
};
export type EntryUpdateInput = {
  // A gold sale edit.
  ornamentType?: string;
  costAmount?: number;
  bankId?: number;
  category?: string;
  amount: number;
  occurredOn?: string;
  remarks?: string;
  receiptImage?: string;
  branchId?: number;
  payments?: PaymentPart[];
  fromBankId?: number;
  fromBank?: string;
  toBankId?: number;
  toBank?: string;
  mode?: string;
};
export type LedgerMode = (typeof LEDGER_MODES)[number];
export type LedgerKind = "bank" | "customer" | "category" | "mode";
export type LedgerParams = { limit: number; offset: number; fromDate?: string; toDate?: string; modes?: string; types?: string; loanNumbers?: string };
// totalDebit/totalCredit cover every row matching the filters, not the page.
export type LedgerPage = { items: LedgerRow[]; total: number; totalDebit?: number; totalCredit?: number; categoryName?: string; loan?: LoanLedgerSummary };
// Set on a loan source's category ledger — the loan's own position, principal-based.
export type LoanLedgerSummary = { sourceId: number; name: string; loanNumber: string; principal: number; drawn: number; repaid: number; balance: number };
// A loan's position — principal, drawn (Add Cash) and repaid (expenses / self
// transfers) so far. GET /cash-sources/:id works for any category id.
export type LoanBalance = { principal: number; drawn: number; repaid: number; balance: number };
// Branch ledger — GET /cash-movements/transactions/branch/:id (web's
// listCashMovementsByBranch). Only the date range is applied server side;
// totals cover every row in that range.
export type BranchLedgerPage = {
  items: CashMovement[];
  total: number;
  totals: { totalIn: number; totalOut: number; net: number; inCount?: number; outCount?: number };
};
