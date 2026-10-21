// Merges manual reminders with computed loan due/overdue/interest events.
export type CalendarEvent = {
  date: string;
  type: "InterestDue" | "LoanDue" | "Overdue" | "FollowUp" | "PromiseToPay" | "Custom" | "PersonalLoanDue" | "PersonalLoanOverdue" | "AuctionScheduled";
  title: string;
  detail: string;
  loanId?: number;
  // Set instead of loanId for PersonalLoanDue / PersonalLoanOverdue events.
  personalLoanId?: number;
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
