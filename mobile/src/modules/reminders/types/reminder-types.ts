// Merges manual reminders with computed loan due/overdue/interest events.
export type CalendarEvent = {
  date: string;
  type: "InterestDue" | "LoanDue" | "Overdue" | "FollowUp" | "PromiseToPay" | "Custom" | "PersonalLoanDue" | "PersonalLoanOverdue" | "InvestmentPayoutDue" | "InvestmentPayoutOverdue" | "AuctionScheduled";
  title: string;
  detail: string;
  loanId?: number;
  // Set instead of loanId for PersonalLoanDue / PersonalLoanOverdue events.
  personalLoanId?: number;
  // Set on InvestmentPayoutDue / InvestmentPayoutOverdue events.
  investmentId?: number;
  investmentNumber?: string;
  loanNumber?: string;
  customerId?: number;
  customerName?: string;
  reminderId?: number;
  status?: string;
};

export type Reminder = {
  id: number;
  customerId: number;
  loanId?: number;
  type: "Follow-Up" | "Promise-to-Pay" | "Custom";
  dueDate: string;
  note: string;
  status: "Pending" | "Done" | "Cancelled";
  createdByEmployeeId: number;
  createdAt: string;
  updatedAt: string;
};
export type ReminderRow = Reminder & {
  customer?: { id: number; name: string; code?: string };
  loan?: { id: number; loanNumber: string };
  customerName?: string;
  customerCode?: string;
  loanNumber?: string;
};
