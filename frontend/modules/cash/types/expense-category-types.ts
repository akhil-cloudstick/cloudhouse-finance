

/* Shape returned by the Go backend (backend/internal/cash/model.go's
 * ExpenseCategory) — a small find-or-create lookup list backing
 * ExpenseModal.tsx's Category picker, replacing the hardcoded CATS array. */
export type BackendExpenseCategory = {
  id: number;
  name: string;
  createdAt: string;
  type?: "cash_in" | "expense" | "self_transfer";
  isCommon?: boolean;
  principalAmount?: number; // a loan's principal, when this category is a loan
};
/* Present when the category is a loan source's repayment category — the
 * ledger is then the loan's own (backend/internal/cash/ledger.go's
 * ListLoanSourceLedger): draws as credits, repayments as debits, running
 * balance = what is still owed (the principal once drawn in full). */
export type LoanLedgerSummary = {
  sourceId: number;
  name: string;
  bankName: string;
  loanNumber: string;
  principal: number;
  drawn: number;
  repaid: number;
  balance: number;
};
