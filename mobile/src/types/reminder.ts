// Mirrors backend/internal/reminder/model.go's CalendarEvent JSON shape —
// merges manual reminders with computed loan due/overdue/interest events.
export type CalendarEvent = {
  date: string;
  type: "InterestDue" | "LoanDue" | "Overdue" | "FollowUp" | "PromiseToPay" | "Custom";
  title: string;
  detail: string;
  loanId?: number;
  loanNumber?: string;
  customerId?: number;
  customerName?: string;
  reminderId?: number;
  status?: string;
};
