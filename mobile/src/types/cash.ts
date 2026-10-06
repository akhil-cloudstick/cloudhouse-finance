// Mirrors backend/internal/cash's CashMovement/Expense JSON shapes.
export type CashMovement = {
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
  payee: string;
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
