// Mirrors the subset of backend/internal/loan/model.go's Loan JSON shape
// the mobile list/detail screens use so far — expand as more loan screens
// (payments, approval chain, auction, bank pledge) are built out.
export type Loan = {
  id: number;
  loanNumber: string;
  branchId: number;
  customerId: number;
  customer?: { id: number; name: string; phone: string };
  status: string;
  openedDate: string;
  dueDate: string;
  principalAmount: number;
  outstandingAmount: number;
};
