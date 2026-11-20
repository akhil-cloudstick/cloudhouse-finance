

/* Shape returned by the Go backend (backend/internal/cash/model.go's
 * CashSource) — a small find-or-create lookup list backing AddCashModal.tsx's
 * "Source of Cash" picker, same pattern as bank.Bank. */
export type BackendCashSource = {
  id: number;
  name: string;
  createdAt: string;
  // Which form the category belongs to; isCommon = shown on every form. A
  // search can return one from another form — picking it makes it common.
  type?: "cash_in" | "expense" | "self_transfer";
  isCommon?: boolean;
  // A loan source's details, captured on its first Add Cash entry (see
  // isLoanSource) — principalAmount present means they're on file.
  loanNumber?: string;
  principalAmount?: number;
};
/* A loan's position (backend MovementService.loanBalance): principal, what
 * has been drawn (Add Cash) and repaid (expenses / self transfers) so far. */
export type LoanBalance = { principal: number; drawn: number; repaid: number; balance: number };
