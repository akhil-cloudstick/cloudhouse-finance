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

// Mirrors backend/internal/reminder/model.go's Reminder JSON shape — the
// persisted row returned by POST /reminders (reminderRequest in handler.go).
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
// GET /reminders with limit/offset — paged, searchable reminder list for the
// dashboard bell's Reminders modal and the Reminders page's day list.
// `q` matches customer name/code and loan number server-side.
export type ReminderRow = Reminder & {
  customer?: { id: number; name: string; code?: string };
  loan?: { id: number; loanNumber: string };
  customerName?: string;
  customerCode?: string;
  loanNumber?: string;
};
