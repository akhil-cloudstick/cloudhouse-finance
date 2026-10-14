import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import { CalendarEvent, type Reminder, type ReminderRow } from "@/modules/reminders/types/reminder-types";

// from/to (YYYY-MM-DD) mirror backend/internal/reminder/handler.go's
// Calendar — defaults server-side to the current month when omitted.
export function getCalendarEvents(from?: string, to?: string) {
  return apiRequest<CalendarEvent[]>("/reminders/calendar", { params: { from, to } });
}

// Logs a manual Reminder (Customer Follow-Up / Promise-to-Pay / Custom) —
// mirrors frontend/modules/reminders/components/AddReminderModalContent.tsx's createReminder call.
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

export function listRemindersPage(params: { limit: number; offset: number; q?: string; status?: string; from?: string; to?: string }) {
  return apiRequest<{ items: ReminderRow[] | null; hasMore: boolean; total?: number }>("/reminders", { params });
}

// Paged calendar events (manual reminders merged with computed loan due /
// overdue / interest events) — backend page/pageSize mode returns
// {events, totalCount}; adapted to the offset/hasMore shape useServerList
// consumes. `q` matches customer name/code and loan number server-side.
export async function listCalendarEventsPage(params: { limit: number; offset: number; q?: string; from?: string; to?: string }) {
  const page = Math.floor(params.offset / params.limit) + 1;
  const rec = await apiRequest<{ events: CalendarEvent[] | null; totalCount: number }>("/reminders/calendar", {
    params: { from: params.from, to: params.to, q: params.q, page, pageSize: params.limit },
  });
  return { items: rec.events ?? [], hasMore: page * params.limit < rec.totalCount, total: rec.totalCount };
}

// Marks a manual reminder Done (PUT /reminders/:id/complete).
export function completeReminder(id: number) {
  return apiRequest<Reminder>(`/reminders/${id}/complete`, { method: "PUT" });
}

export function deleteReminder(id: number) {
  return apiRequest<void>(`/reminders/${id}`, { method: "DELETE" });
}
