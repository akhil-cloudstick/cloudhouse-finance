"use client";

import { useCallback, useEffect, useMemo, useState, type UIEvent } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { AddReminderModalContent } from "@/modules/reminders/components/AddReminderModalContent";
import { completeReminder, deleteReminder, getCalendarEvents } from "@/modules/reminders/services/reminderService";
import { type CalendarEvent } from "@/modules/reminders/types/reminder-types";
import { useAuth } from "@/common/providers/AuthProvider";
import { useIsSmallScreen } from "@/common/utils/responsive";
import { routeHref } from "@/common/services/appRoutes";
import { useCanOpenRoute } from "@/common/hooks/use-can-open-route";
import { fmtDate } from "@/common/utils/format";

// Day-panel events render this many at a time; scrolling to the bottom of the
// panel reveals the next batch.
const DAY_PAGE_SIZE = 8;

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* Maps each of the seven calendar-event categories to one of the app's four
 * existing event-chip colors (app.css's .ev.due/.over/.fup/.pay) — there's
 * no dedicated color per category, but the title text always spells out
 * which one it is. */
function evClass(type: CalendarEvent["type"]): string {
  switch (type) {
    case "Overdue": return "over";
    case "PersonalLoanOverdue": return "over";
    case "LoanDue": return "due";
    case "PersonalLoanDue": return "due";
    case "AuctionScheduled": return "due";
    case "InterestDue": return "pay";
    case "PromiseToPay": return "fup";
    case "FollowUp": return "fup";
    default: return "fup";
  }
}

/* The day panel groups a day's events into these segments, each shown as a
 * coloured count circle (colours match the .ev chips on the grid). */
const GROUPS: { key: string; label: string; tone: "red" | "amber" | "green" | "info"; types: string[] }[] = [
  { key: "overdue", label: "Overdue", tone: "red", types: ["Overdue", "PersonalLoanOverdue"] },
  { key: "due", label: "Loan due", tone: "amber", types: ["LoanDue", "PersonalLoanDue"] },
  { key: "auction", label: "Auction", tone: "amber", types: ["AuctionScheduled"] },
  { key: "interest", label: "Interest", tone: "green", types: ["InterestDue"] },
  { key: "followup", label: "Follow-up", tone: "info", types: ["FollowUp"] },
  { key: "promise", label: "Promise to pay", tone: "info", types: ["PromiseToPay"] },
];
const GROUPED_TYPES = GROUPS.flatMap((g) => g.types);

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
 * overdue loans, monthly interest-payment reminders, scheduled auction
 * dates, and manual Customer Follow-Up/Promise-to-Pay/Custom reminders —
 * for the visible month from GET /reminders/calendar (see
 * backend/internal/reminder), with month navigation and a click-to-inspect
 * day panel. */
export function CalendarPage() {
  const { openModal } = useModal();
  const toast = useToast();
  // Adding, completing and deleting reminders each need their own grant;
  // the calendar itself stays readable either way (see Customers.tsx).
  const { can } = useAuth();
  const canOpen = useCanOpenRoute();
  const smallScreen = useIsSmallScreen();
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
  const [dayVisible, setDayVisible] = useState(DAY_PAGE_SIZE);
  // Which segment's events are expanded in the day panel (null = just the circles).
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  // A different day (or month) starts again from the first page.
  useEffect(() => { setDayVisible(DAY_PAGE_SIZE); setOpenGroup(null); }, [selectedDay, year, month]);
  useEffect(() => { setDayVisible(DAY_PAGE_SIZE); }, [openGroup]);

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

  // Jump to any month: used by Prev/Next and by the month / year pickers.
  function goTo(y: number, m: number) {
    const d = new Date(y, m, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setSelectedDay(null);
  }

  function goMonth(delta: number) {
    goTo(year, month + delta);
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

  const allDayEvents = selectedDay != null ? eventsByDay.get(selectedDay) || [] : [];
  const groupsOfDay = [
    ...GROUPS.map((g) => ({ ...g, items: allDayEvents.filter((e) => g.types.includes(e.type)) })),
    { key: "other", label: "Other", tone: "info" as const, types: [], items: allDayEvents.filter((e) => !GROUPED_TYPES.includes(e.type)) },
  ].filter((g) => g.items.length > 0);
  const dayEvents = groupsOfDay.find((g) => g.key === openGroup)?.items ?? [];
  function onDayScroll(e: UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (dayVisible < dayEvents.length && el.scrollTop + el.clientHeight >= el.scrollHeight - 24) {
      setDayVisible((n) => Math.min(dayEvents.length, n + DAY_PAGE_SIZE));
    }
  }
  const selectedISO = selectedDay != null ? toISODate(year, month, selectedDay) : undefined;

  return (
    <>
      <div className="page-h page-h-stack">
        {/* .page-h-title (flex:1;min-width:0) lets this block shrink and
         * wrap its subtitle instead of holding its full natural width and
         * forcing .page-h-actions below it — the same pattern LoanDetail
         * uses, for the same reason: the title + nav/Add Reminder buttons
         * were landing right at the wrap threshold, dropping the whole
         * button cluster (Add Reminder especially) to its own line at
         * anything but a very wide window even though there was still
         * visibly room for it. */}
        <div className="page-h-title"><h1>EMI / Interest Reminder Calendar</h1><p>{fmtMonthYear(year, month)} · due dates, overdue loans, follow-ups &amp; promise-to-pay</p></div>
        <div className="page-h-actions">
          {canCreateReminders && (
            <button className="btn" onClick={() => openModal(<AddReminderModalContent initialDate={selectedISO} onSaved={load} />)}>
              <Icon name="plus" /> Add Reminder
            </button>
          )}
        </div>
      </div>
      {/* 5px less bottom margin on small screens (laptop-height windows,
       * see useIsSmallScreen) to tighten the gap between the header and the
       * Due/Overdue/Follow-up/Payment legend row right below it. */}
      <hr className="gold-rule" style={smallScreen ? { margin: "4px 0 18px" } : undefined} />
      {/* The Due/Overdue/Follow-up/Payment legend now sits below the rule,
       * left-aligned, rather than crammed onto the title row's right side
       * (moved once already) or between the title and the rule — reading
       * as a legend for the calendar grid directly beneath it. */}
      <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
        <span className="chip amber">Due</span>
        <span className="chip red">Overdue</span>
        <span className="chip info">Follow-up</span>
        <span className="chip green">Payment</span>
      </div>
      {err && <p style={{ color: "var(--red)", fontSize: 13 }}>{err}</p>}
      <div className="grid cols21" style={{ alignItems: "start" }}>
        <div className="grid">
        <div className="card">
          {/* Month label with its small prev/next buttons right beside it, directly above the grid. */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 12px 0" }}>
            <button className="btn ghost sm" style={{ padding: "2px 8px", minWidth: 0, height: 31 }} onClick={() => goMonth(-1)} aria-label="Previous month">‹</button>
            <select className="inp" aria-label="Month" style={{ width: 112, padding: "2px 6px", height: 31 }} value={month} onChange={(e) => goTo(year, +e.target.value)}>
              {Array.from({ length: 12 }, (_, m) => <option key={m} value={m}>{new Date(2000, m, 1).toLocaleString("en-US", { month: "long" })}</option>)}
            </select>
            <select className="inp" aria-label="Year" style={{ width: 84, padding: "2px 6px", height: 31 }} value={year} onChange={(e) => goTo(+e.target.value, month)}>
              {Array.from(new Set([...Array.from({ length: 21 }, (_, i) => today.getFullYear() - 10 + i), year])).sort((a, b) => a - b).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button className="btn ghost sm" style={{ padding: "2px 8px", minWidth: 0, height: 31 }} onClick={() => goMonth(1)} aria-label="Next month">›</button>
            <button className="btn ghost sm" style={{ marginLeft: 6 }} onClick={goToday}>Today</button>
          </div>
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
                        if (!d) return <td key={j} style={{ background: "var(--bg)" }} />;
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
        </div>

        <div className="grid">
          {selectedDay == null ? (
          <div className="card">
            <div className="hd"><h3>This Month at a Glance</h3></div>
            <div className="bd" style={{ paddingTop: 6 }}>
              <ul className="mini-list">
                <li><span className="tx"><b>Loan due dates</b><small>{events.filter((e) => e.type === "LoanDue").length} loans due this month</small></span></li>
                <li><span className="tx"><b>Overdue loans</b><small>{events.filter((e) => e.type === "Overdue").length} loans overdue</small></span></li>
                <li><span className="tx"><b>Interest reminders</b><small>{events.filter((e) => e.type === "InterestDue").length} scheduled</small></span></li>
                <li><span className="tx"><b>Scheduled auctions</b><small>{events.filter((e) => e.type === "AuctionScheduled").length} loans scheduled for auction</small></span></li>
                <li><span className="tx"><b>Customer follow-ups</b><small>{events.filter((e) => e.type === "FollowUp").length} logged</small></span></li>
                <li><span className="tx"><b>Promise-to-pay dates</b><small>{events.filter((e) => e.type === "PromiseToPay").length} logged</small></span></li>
              </ul>
            </div>
          </div>
          ) : (
          <div className="card">
            <div className="hd" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3>{fmtDate(toISODate(year, month, selectedDay))}</h3>
              <button className="btn ghost sm" onClick={() => setSelectedDay(null)}>Month summary</button>
            </div>
            <div className="bd no-scrollbar" style={{ paddingTop: 6, maxHeight: 420, overflowY: "auto" }} onScroll={onDayScroll}>
              {groupsOfDay.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: "8px 0 12px" }}>
                  {groupsOfDay.map((g) => {
                    const on = openGroup === g.key;
                    return (
                      <button
                        key={g.key}
                        type="button"
                        onClick={() => setOpenGroup(on ? null : g.key)}
                        aria-pressed={on}
                        title={`${g.label}: ${g.items.length}`}
                        style={{ background: "none", border: 0, padding: 0, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 64 }}
                      >
                        <span style={{ width: 40, height: 40, borderRadius: "50%", display: "grid", placeContent: "center", fontWeight: 700, fontSize: 14, background: `var(--${g.tone}-bg)`, color: `var(--${g.tone})`, border: `2px solid ${on ? `var(--${g.tone})` : "transparent"}` }}>{g.items.length}</span>
                        <span style={{ fontSize: 10.5, color: on ? "var(--charcoal)" : "var(--muted)", textAlign: "center", lineHeight: 1.2 }}>{g.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <ul className="mini-list">
                {selectedDay == null ? (
                  <li><span className="tx"><small>Click a day on the calendar to see its events.</small></span></li>
                ) : allDayEvents.length === 0 ? (
                  <li><span className="tx"><small>No events on this day.</small></span></li>
                ) : openGroup == null ? (
                  <li><span className="tx"><small>Select a circle to see its events.</small></span></li>
                ) : dayEvents.slice(0, dayVisible).map((e, i) => (
                  <li key={i}>
                    <span className="ic" style={(e.type === "Overdue" || e.type === "PersonalLoanOverdue") ? { background: "var(--red-bg)", color: "var(--red)" } : undefined}>
                      <Icon name={e.type === "FollowUp" ? "phone" : e.type === "PromiseToPay" ? "clock" : e.type === "AuctionScheduled" ? "gavel" : "bell"} />
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
                    {e.personalLoanId != null && canOpen("personalloan") ? (
                      <span className="rt"><a className="btn sm ghost" href={routeHref(`personalloan/${e.personalLoanId}`)}>Open loan</a></span>
                    ) : e.loanNumber && canOpen("loan") ? (
                      <span className="rt"><a className="btn sm ghost" href={routeHref(`loan/${e.loanNumber}`)}>Open loan</a></span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          )}
        </div>
      </div>
    </>
  );
}
