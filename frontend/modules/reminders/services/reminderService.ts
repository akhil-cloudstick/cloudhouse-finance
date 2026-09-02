import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";

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

export type CreateReminderInput = {
  customerId: number;
  loanId?: number | null;
  type: "Follow-Up" | "Promise-to-Pay" | "Custom";
  dueDate: string; // "YYYY-MM-DD"
  note?: string;
  employeeId: number;
};

export async function createReminder(input: CreateReminderInput): Promise<ReminderView> {
  const rec = await apiFetch<BackendReminder>("/reminders", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toView(rec);
}

export type UpdateReminderInput = {
  type: "Follow-Up" | "Promise-to-Pay" | "Custom";
  dueDate: string;
  note?: string;
  status?: "Pending" | "Done" | "Cancelled";
};

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

export type ReminderFilters = { customerId?: number; loanId?: number; status?: string; from?: string; to?: string };

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

/* --- Calendar aggregation -------------------------------------------------
 * Backs GET /reminders/calendar — merges live loan due/overdue/interest-
 * anniversary events with manual reminders (see
 * backend/internal/reminder/service.go's GetCalendarEvents). This is the
 * single source of truth the Calendar page and Dashboard's "Upcoming
 * Reminders" card both read from. */
export type CalendarEventType =
  | "InterestDue" | "LoanDue" | "Overdue"
  | "PersonalLoanDue" | "PersonalLoanOverdue"
  | "FollowUp" | "PromiseToPay" | "Custom";

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
