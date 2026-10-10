

/* Mirrors backend/internal/reminder/model.go's Reminder — returned directly,
 * not through a separate response DTO (matches loan's convention). */
export type BackendReminder = {
  id: number;
  customerId: number;
  customer?: { id: number; name: string; code: string; phone: string };
  loanId?: number | null;
  type: "Follow-Up" | "Promise-to-Pay" | "Custom";
  dueDate: string;
  note: string;
  status: "Pending" | "Done" | "Cancelled";
  createdByEmployeeId: number;
  createdAt: string;
  updatedAt: string;
};
export type ReminderView = {
  id: number;
  customerId: number;
  customerName: string;
  loanId: number | null;
  type: "Follow-Up" | "Promise-to-Pay" | "Custom";
  dueDate: string; // "YYYY-MM-DD"
  note: string;
  status: "Pending" | "Done" | "Cancelled";
};
export type CreateReminderInput = {
  customerId: number;
  loanId?: number | null;
  type: "Follow-Up" | "Promise-to-Pay" | "Custom";
  dueDate: string; // "YYYY-MM-DD"
  note?: string;
  employeeId: number;
};
export type UpdateReminderInput = {
  type: "Follow-Up" | "Promise-to-Pay" | "Custom";
  dueDate: string;
  note?: string;
  status?: "Pending" | "Done" | "Cancelled";
};
export type ReminderFilters = { customerId?: number; loanId?: number; status?: string; from?: string; to?: string };
/* --- Calendar aggregation -------------------------------------------------
 * Backs GET /reminders/calendar — merges live loan due/overdue/interest-
 * anniversary events with manual reminders (see
 * backend/internal/reminder/service.go's GetCalendarEvents). This is the
 * single source of truth the Calendar page and Dashboard's "Upcoming
 * Reminders" card both read from. */
export type CalendarEventType =
  | "InterestDue" | "LoanDue" | "Overdue"
  | "PersonalLoanDue" | "PersonalLoanOverdue"
  | "AuctionScheduled" | "FollowUp" | "PromiseToPay" | "Custom";
export type CalendarEvent = {
  date: string; // "YYYY-MM-DD"
  type: CalendarEventType;
  title: string;
  detail: string;
  loanId?: number;
  loanNumber?: string;
  // Set instead of loanId for PersonalLoanDue/PersonalLoanOverdue events —
  // kept separate so a personal loan's numeric ID is never mistaken for a
  // gold loan's (see backend/internal/reminder/model.go's CalendarEvent).
  personalLoanId?: number;
  customerId?: number;
  customerName?: string;
  reminderId?: number; // only set for manual (persisted) events
  status?: string; // only set for manual events
};
