import { apiRequest } from "./client";
import { CalendarEvent } from "../types/reminder";

// from/to (YYYY-MM-DD) mirror backend/internal/reminder/handler.go's
// Calendar — defaults server-side to the current month when omitted.
export function getCalendarEvents(from?: string, to?: string) {
  return apiRequest<CalendarEvent[]>("/reminders/calendar", { params: { from, to } });
}
