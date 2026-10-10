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
  createdAt: string;
};

export type CashSummary = {
  openingCash: number;
  collections: number;
  disbursements: number;
  cashExpenses: number;
  expectedCash: number;
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
// (bank/loanNumber/principalAmount required, interestRate/durationMonths
// optional). See backend/internal/cash/model.go's LoanCashSource.
export type LoanSourceInput = {
  bankId: number;
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
// captured details (bankId/bank/principalAmount) once on file.
export type CategoryType = "cash_in" | "expense" | "self_transfer";
export type CashSource = {
  id: number;
  name: string;
  createdAt: string;
  type?: CategoryType;
  isCommon?: boolean;
  bankId?: number;
  bank?: { id: number; name: string };
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
};
export type LedgerMode = (typeof LEDGER_MODES)[number];
export type LedgerKind = "bank" | "customer" | "category" | "mode";
export type LedgerParams = { limit: number; offset: number; fromDate?: string; toDate?: string };
// totalDebit/totalCredit cover every row matching the filters, not the page.
export type LedgerPage = { items: LedgerRow[]; total: number; totalDebit?: number; totalCredit?: number; categoryName?: string };
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
