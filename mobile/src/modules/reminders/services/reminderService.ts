import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import { CalendarEvent, type Reminder, type ReminderRow } from "@/modules/reminders/types/reminder-types";

// from/to default server-side to the current month when omitted.
export function getCalendarEvents(from?: string, to?: string) {
  return apiRequest<CalendarEvent[]>("/reminders/calendar", { params: { from, to } });
}

// dueDate is "YYYY-MM-DD".
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

// Adapts the backend's {events, totalCount} page/pageSize mode to the offset/hasMore shape useServerList expects.
export async function listCalendarEventsPage(params: { limit: number; offset: number; q?: string; from?: string; to?: string }) {
  const page = Math.floor(params.offset / params.limit) + 1;
  const rec = await apiRequest<{ events: CalendarEvent[] | null; totalCount: number }>("/reminders/calendar", {
    params: { from: params.from, to: params.to, q: params.q, page, pageSize: params.limit },
  });
  return { items: rec.events ?? [], hasMore: page * params.limit < rec.totalCount, total: rec.totalCount };
}

export function completeReminder(id: number) {
  return apiRequest<Reminder>(`/reminders/${id}/complete`, { method: "PUT" });
}

export function deleteReminder(id: number) {
  return apiRequest<void>(`/reminders/${id}`, { method: "DELETE" });
}
