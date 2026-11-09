import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import { enqueueAndWait, newEntry, offlineReady } from "@/common/offline";
import { queueWrite } from "@/common/offline/queueWrite";
import { refuse } from "@/common/offline/validate";
import { currentActor } from "@/common/offline/actor";
import { createsReminder, findLocalRequest } from "@/common/offline/requestRef";
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

const REMINDER_TYPES: string[] = ["Follow-Up", "Promise-to-Pay", "Custom"];

export async function createReminder(input: CreateReminderInput): Promise<ReminderView> {
	// Desktop: the reminder goes into the outbox first and shows in the calendar and the list at once (see
	// common/offline/reminderAdjust.ts); the sender posts it. The call returns at once.
	if (offlineReady()) {
		// the server's own checks (reminder validate)
		if (!input.customerId) refuse("customer is required");
		if (!REMINDER_TYPES.includes(input.type)) refuse("type must be Follow-Up, Promise-to-Pay, or Custom");
		if (!input.dueDate) refuse("due date is required");
		const entry = newEntry("POST", "/reminders", input, currentActor());
		await enqueueAndWait(entry, () => undefined, () => undefined);
		return {
			id: 0,
			customerId: input.customerId,
			customerName: "—",
			loanId: input.loanId ?? null,
			type: input.type,
			dueDate: input.dueDate,
			note: input.note ?? "",
			status: "Pending",
		};
	}
	const rec = await apiFetch<BackendReminder>("/reminders", {
		method: "POST",
		body: JSON.stringify(input),
	});
	return toView(rec);
}

/* A reminder made on this PC and not sent yet has a local (negative) id; it is addressed by the entry that creates it,
 * and by the server's id once that entry has been sent (see common/offline/requestRef.ts). */
async function reminderPath(id: number): Promise<string> {
	if (id > 0) return `/reminders/${id}`;
	const found = offlineReady() ? await findLocalRequest(id, createsReminder) : null;
	if (!found) throw new Error("This reminder has not reached the server yet. Try again once it has synced.");
	return "entryId" in found ? `/reminders/ref:${found.entryId}` : `/reminders/${found.serverId}`;
}

export async function updateReminder(id: number, input: UpdateReminderInput): Promise<ReminderView> {
	const path = await reminderPath(id);
	if (offlineReady()) {
		if (!REMINDER_TYPES.includes(input.type)) refuse("type must be Follow-Up, Promise-to-Pay, or Custom");
		if (!input.dueDate) refuse("due date is required");
	}
	return queueWrite("PUT", path, input, { id, ...input } as unknown as ReminderView, async () =>
		toView(await apiFetch<BackendReminder>(path, { method: "PUT", body: JSON.stringify(input) }))
	);
}

export async function completeReminder(id: number): Promise<ReminderView> {
	const path = `${await reminderPath(id)}/complete`;
	return queueWrite("PUT", path, undefined, { id, status: "Done" } as unknown as ReminderView, async () =>
		toView(await apiFetch<BackendReminder>(path, { method: "PUT" }))
	);
}

export async function deleteReminder(id: number): Promise<void> {
	const path = await reminderPath(id);
	await queueWrite("DELETE", path, undefined, undefined, () => apiFetch<void>(path, { method: "DELETE" }));
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
