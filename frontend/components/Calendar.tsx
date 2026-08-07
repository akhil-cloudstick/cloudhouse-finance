"use client";

import { useData } from "@/lib/DataProvider";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// July 2026: starts Wednesday(3), 31 days — hardcoded demo month, same as legacy.
const START_DOW = 3;
const N_DAYS = 31;
const TODAY = 30;

/* Ported from legacy/app.js's `renderCalendar()`. Purely static — no month
 * navigation, no day-click handlers, no add-reminder modal exist in legacy
 * either; the grid is a one-shot render of a hardcoded month. */
export function Calendar() {
  const { db } = useData();

  const cells: (number | "")[][] = [];
  let week: (number | "")[] = new Array(START_DOW).fill("");
  for (let d = 1; d <= N_DAYS; d++) {
    week.push(d);
    if (week.length === 7) { cells.push(week); week = []; }
  }
  if (week.length) {
    while (week.length < 7) week.push("");
    cells.push(week);
  }

  return (
    <>
      <div className="page-h">
        <div><h1>EMI / Interest Reminder Calendar</h1><p>July 2026 · due dates, overdue loans, follow-ups &amp; promise-to-pay</p></div>
        <div className="sp" />
        <span className="chip amber">Due</span> <span className="chip red">Overdue</span> <span className="chip blue">Follow-up</span> <span className="chip green">Payment</span>
      </div>
      <hr className="gold-rule" />
      <div className="card">
        <div className="bd" style={{ padding: 10, overflowX: "auto" }}>
          <table className="cal">
            <thead><tr>{DAYS.map((d) => <th key={d}>{d}</th>)}</tr></thead>
            <tbody>
              {cells.map((w, i) => (
                <tr key={i}>
                  {w.map((d, j) => {
                    if (!d) return <td key={j} style={{ background: "#faf6ea" }} />;
                    const evs = db.calendarEvents[d] || [];
                    return (
                      <td key={j} className={d === TODAY ? "today" : ""}>
                        <span className="d">{d}</span>
                        {evs.map((e, k) => <span className={`ev ${e.c}`} key={k}>{e.t}</span>)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ft">SMS &amp; WhatsApp reminders are sent automatically for due/overdue events · full communication history kept per loan</div>
      </div>
    </>
  );
}
