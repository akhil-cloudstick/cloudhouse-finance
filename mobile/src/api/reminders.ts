import { apiRequestEnveloped as apiRequest } from "./client";
import { CalendarEvent } from "../types/reminder";

// from/to (YYYY-MM-DD) mirror backend/internal/reminder/handler.go's
// Calendar — defaults server-side to the current month when omitted.
export function getCalendarEvents(from?: string, to?: string) {
  return apiRequest<CalendarEvent[]>("/reminders/calendar", { params: { from, to } });
}

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

// Logs a manual Reminder (Customer Follow-Up / Promise-to-Pay / Custom) —
// mirrors frontend/components/modals/ReminderModal.tsx's createReminder call.
// dueDate is "YYYY-MM-DD" (handler.go's parseDate).
export function createReminder(input: {
  customerId: number;
  loanId?: number | null;
  type: "Follow-Up" | "Promise-to-Pay" | "Custom";
  dueDate: string;
  note?: string;
  employeeId: number;
}) {
  return apiRequest<Reminder>("/reminders", { method: "POST", body: input });
}
