import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import type { BackendReminder, ReminderView, CreateReminderInput, UpdateReminderInput, ReminderFilters, CalendarEvent } from "@/modules/reminders/types/reminder-types";

function toView(r: BackendReminder): ReminderView {
  return {
    id: r.id,
    customerId: r.customerId,
    customerName: r.customer?.name || "—",
    loanId: r.loanId ?? null,
    type: r.type,
    dueDate: r.dueDate ? r.dueDate.slice(0, 10) : "",
    note: r.note,
    status: r.status,
  };
}

export async function createReminder(input: CreateReminderInput): Promise<ReminderView> {
  const rec = await apiFetch<BackendReminder>("/reminders", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toView(rec);
}

export async function updateReminder(id: number, input: UpdateReminderInput): Promise<ReminderView> {
  const rec = await apiFetch<BackendReminder>(`/reminders/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return toView(rec);
}

export async function completeReminder(id: number): Promise<ReminderView> {
  const rec = await apiFetch<BackendReminder>(`/reminders/${id}/complete`, { method: "PUT" });
  return toView(rec);
}

export async function deleteReminder(id: number): Promise<void> {
  await apiFetch<void>(`/reminders/${id}`, { method: "DELETE" });
}

export async function listReminders(filters?: ReminderFilters): Promise<ReminderView[]> {
  const params = new URLSearchParams();
  if (filters?.customerId) params.set("customerId", String(filters.customerId));
  if (filters?.loanId) params.set("loanId", String(filters.loanId));
  if (filters?.status) params.set("status", filters.status);
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  const qs = params.toString();
  const rec = await apiFetch<BackendReminder[]>(`/reminders${qs ? `?${qs}` : ""}`);
  return (rec || []).map(toView);
}

export async function getCalendarEvents(from: string, to: string): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({ from, to });
  // A month with zero events serializes as JSON null (Go's encoding/json
  // for a nil, never-appended-to slice — see reminder/service.go's
  // GetCalendarEvents), not [] — fall back so Calendar.tsx's `for...of
  // events` doesn't throw "events is not iterable".
  const rec = await apiFetch<CalendarEvent[]>(`/reminders/calendar?${params.toString()}`);
  return rec || [];
}

/* Paginated variant backing Dashboard.tsx's "Upcoming Reminders" card —
 * sending both `page` and `pageSize` switches GET /reminders/calendar to the
 * {events, totalCount} envelope (backend/internal/reminder/handler.go's
 * Calendar); omitting either keeps the plain-array shape getCalendarEvents
 * above relies on, so Calendar.tsx's full-month view is unaffected. The
 * backend now does the Overdue-first-then-by-date sort and the page slicing
 * that used to happen client-side in Dashboard.tsx. */
export async function getCalendarEventsPage(
  from: string,
  to: string,
  page: number,
  pageSize: number
): Promise<{ events: CalendarEvent[]; totalCount: number }> {
  const params = new URLSearchParams({ from, to, page: String(page), pageSize: String(pageSize) });
  const rec = await apiFetch<{ events: CalendarEvent[] | null; totalCount: number }>(`/reminders/calendar?${params.toString()}`);
  return { events: rec.events || [], totalCount: rec.totalCount || 0 };
}
