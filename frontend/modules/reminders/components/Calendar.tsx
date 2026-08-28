"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { Icon } from "@/common/components/Icon";
import { AddReminderModalContent } from "@/common/components/modals/ReminderModal";
import { completeReminder, deleteReminder, getCalendarEvents, type CalendarEvent } from "@/modules/reminders/services/reminderService";
import { useAuth } from "@/common/auth-context";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* Maps each of the six calendar-event categories to one of the app's four
 * existing event-chip colors (app.css's .ev.due/.over/.fup/.pay) — there's
 * no dedicated color per category, but the title text always spells out
 * which one it is. */
function evClass(type: CalendarEvent["type"]): string {
  switch (type) {
    case "Overdue": return "over";
    case "LoanDue": return "due";
    case "InterestDue": return "pay";
    case "PromiseToPay": return "fup";
    case "FollowUp": return "fup";
    default: return "fup";
  }
}

function fmtMonthYear(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function toISODate(year: number, month: number, day: number): string {
  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

/* Real, backend-backed Reminder Calendar (replaces the previous static
 * July-2026 mock render). Fetches the merged event set — loan due dates,
 * overdue loans, monthly interest-payment reminders, and manual Customer
 * Follow-Up/Promise-to-Pay/Custom reminders — for the visible month from
 * GET /reminders/calendar (see backend/internal/reminder), with month
 * navigation and a click-to-inspect day panel. */
export function Calendar() {
  const { openModal } = useModal();
  const toast = useToast();
  // Adding, completing and deleting reminders each need their own grant;
  // the calendar itself stays readable either way (see Customers.tsx).
  const { can } = useAuth();
  const canCreateReminders = can("Reminder_Management", "can_create_reminder");
  const canUpdateReminders = can("Reminder_Management", "can_update_reminder");
  const canDeleteReminders = can("Reminder_Management", "can_delete_reminder");

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-based
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const todayISO = today.toISOString().slice(0, 10);
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();

  const load = useCallback(() => {
    const from = toISODate(year, month, 1);
    const to = toISODate(year, month, new Date(year, month + 1, 0).getDate());
    setLoading(true);
    getCalendarEvents(from, to)
      .then((list) => { setEvents(list); setErr(""); })
      .catch((e) => setErr(e instanceof Error ? e.message : "Failed to load the calendar."))
      .finally(() => setLoading(false));
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const eventsByDay = useMemo(() => {
    const map = new Map<number, CalendarEvent[]>();
    for (const e of events) {
      const day = Number(e.date.slice(8, 10));
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(e);
    }
    return map;
  }, [events]);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow = new Date(year, month, 1).getDay();

  const cells: (number | "")[][] = [];
  let week: (number | "")[] = new Array(startDow).fill("");
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) { cells.push(week); week = []; }
  }
  if (week.length) {
    while (week.length < 7) week.push("");
    cells.push(week);
  }

  function goMonth(delta: number) {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setSelectedDay(null);
  }

  function goToday() {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setSelectedDay(today.getDate());
  }

  async function onComplete(reminderId: number) {
    try {
      await completeReminder(reminderId);
      toast("Reminder marked done.");
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to update reminder.");
    }
  }

  async function onDelete(reminderId: number) {
    try {
      await deleteReminder(reminderId);
      toast("Reminder deleted.");
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to delete reminder.");
    }
  }

  const dayEvents = selectedDay != null ? eventsByDay.get(selectedDay) || [] : [];
  const selectedISO = selectedDay != null ? toISODate(year, month, selectedDay) : undefined;

  return (
    <>
      <div className="page-h">
        <div><h1>EMI / Interest Reminder Calendar</h1><p>{fmtMonthYear(year, month)} · due dates, overdue loans, follow-ups &amp; promise-to-pay</p></div>
        <div className="sp" />
        <span className="chip amber">Due</span> <span className="chip red">Overdue</span> <span className="chip blue">Follow-up</span> <span className="chip green">Payment</span>
        <button className="btn ghost" onClick={goToday}>Today</button>
        <button className="btn ghost" onClick={() => goMonth(-1)}>‹ Prev</button>
        <button className="btn ghost" onClick={() => goMonth(1)}>Next ›</button>
        {canCreateReminders && (
          <button className="btn" onClick={() => openModal(<AddReminderModalContent initialDate={selectedISO} onSaved={load} />)}>
            <Icon name="plus" /> Add Reminder
          </button>
        )}
      </div>
      <hr className="gold-rule" />
      {err && <p style={{ color: "var(--red)", fontSize: 13 }}>{err}</p>}
      <div className="grid cols21">
        <div className="card">
          <div className="bd" style={{ padding: 10, overflowX: "auto" }}>
            {loading ? (
              <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading calendar…</p>
            ) : (
              <table className="cal">
                <thead><tr>{DAYS.map((d) => <th key={d}>{d}</th>)}</tr></thead>
                <tbody>
                  {cells.map((w, i) => (
                    <tr key={i}>
                      {w.map((d, j) => {
                        if (!d) return <td key={j} style={{ background: "#faf6ea" }} />;
                        const evs = eventsByDay.get(d) || [];
                        const isToday = isCurrentMonth && d === today.getDate();
                        return (
                          <td
                            key={j}
                            className={`${isToday ? "today" : ""} ${selectedDay === d ? "sel" : ""}`}
                            style={{ cursor: "pointer" }}
                            onClick={() => setSelectedDay(d)}
                          >
                            <span className="d">{d}</span>
                            {evs.slice(0, 3).map((e, k) => <span className={`ev ${evClass(e.type)}`} key={k}>{e.title}</span>)}
                            {evs.length > 3 && <span className="ev fup">+{evs.length - 3} more</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="ft">Click a day to see its full list of events and log a follow-up, promise-to-pay date, or custom reminder.</div>
        </div>

        <div className="grid">
          <div className="card">
            <div className="hd"><h3>{selectedDay != null ? `${fmtMonthYear(year, month)} ${selectedDay}` : "Select a day"}</h3></div>
            <div className="bd" style={{ paddingTop: 6 }}>
              <ul className="mini-list">
                {selectedDay == null ? (
                  <li><span className="tx"><small>Click a day on the calendar to see its events.</small></span></li>
                ) : dayEvents.length === 0 ? (
                  <li><span className="tx"><small>No events on this day.</small></span></li>
                ) : dayEvents.map((e, i) => (
                  <li key={i}>
                    <span className="ic" style={e.type === "Overdue" ? { background: "var(--red-bg)", color: "var(--red)" } : undefined}>
                      <Icon name={e.type === "FollowUp" ? "phone" : e.type === "PromiseToPay" ? "clock" : "bell"} />
                    </span>
                    <span className="tx">
                      <b>{e.title}</b>
                      <small>{e.detail}{e.loanNumber ? ` · ${e.loanNumber}` : ""}</small>
                    </span>
                    {e.reminderId != null && (
                      <span className="rt" style={{ display: "flex", gap: 4 }}>
                        {canUpdateReminders && e.status !== "Done" && (
                          <button className="btn sm ghost" onClick={() => onComplete(e.reminderId!)}>Done</button>
                        )}
                        {canDeleteReminders && <button className="btn sm ghost" onClick={() => onDelete(e.reminderId!)}>Delete</button>}
                      </span>
                    )}
                    {e.loanNumber && <span className="rt"><a className="btn sm ghost" href={`#loan/${e.loanNumber}`}>Open loan</a></span>}
                  </li>
                ))}
              </ul>
            </div>
            {selectedDay != null && canCreateReminders && (
              <div className="ft">
                <button className="btn ghost" onClick={() => openModal(<AddReminderModalContent initialDate={selectedISO} onSaved={load} />)}>
                  <Icon name="plus" /> Add Reminder for this day
                </button>
              </div>
            )}
          </div>

          <div className="card">
            <div className="hd"><h3>This Month at a Glance</h3></div>
            <div className="bd" style={{ paddingTop: 6 }}>
              <ul className="mini-list">
                <li><span className="tx"><b>Loan due dates</b><small>{events.filter((e) => e.type === "LoanDue").length} loans due this month</small></span></li>
                <li><span className="tx"><b>Overdue loans</b><small>{events.filter((e) => e.type === "Overdue").length} loans overdue</small></span></li>
                <li><span className="tx"><b>Interest reminders</b><small>{events.filter((e) => e.type === "InterestDue").length} scheduled</small></span></li>
                <li><span className="tx"><b>Customer follow-ups</b><small>{events.filter((e) => e.type === "FollowUp").length} logged</small></span></li>
                <li><span className="tx"><b>Promise-to-pay dates</b><small>{events.filter((e) => e.type === "PromiseToPay").length} logged</small></span></li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
