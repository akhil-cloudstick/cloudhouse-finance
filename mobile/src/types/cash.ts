// Mirrors backend/internal/cash's CashMovement/Expense JSON shapes.
export type CashMovement = {
  id: number;
  type: "in" | "out";
  source: string;
  purpose: string;
  bank?: string;
  amount: number;
  status?: string;
  branchId: number;
  branch?: { id: number; name: string };
  occurredOn: string;
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
