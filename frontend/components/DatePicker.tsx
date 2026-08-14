"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icons";

const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parseISO(v: string): Date | null {
  if (!v) return null;
  const [y, m, d] = v.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Themed replacement for `<input type="date">`, whose calendar popup is
 * drawn by the OS/browser and can't be restyled to match the app's gold/
 * ivory theme. Same `.inp`-sized trigger (icon + formatted date) as the
 * rest of the form, opening a popover calendar built from the app's own
 * card/panel styling (see `.dp-*` in app.css, modeled on SearchableSelect's
 * `.gs-results` panel) instead of the native picker.
 */
export function DatePicker({
  value,
  onChange,
  placeholder = "Select date…",
  min,
  max,
  disabled,
}: {
  value: string; // "YYYY-MM-DD"
  onChange: (v: string) => void;
  placeholder?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseISO(value);
  const [viewYear, setViewYear] = useState(() => (selected || new Date()).getFullYear());
  const [viewMonth, setViewMonth] = useState(() => (selected || new Date()).getMonth());
  const boxRef = useRef<HTMLDivElement>(null);

  // Jump the visible month back to the selected (or current) date every time
  // the popover is (re)opened, rather than remembering wherever it was left.
  useEffect(() => {
    if (!open) return;
    const d = parseISO(value) || new Date();
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const minD = min ? parseISO(min) : null;
  const maxD = max ? parseISO(max) : null;

  function inRange(d: Date): boolean {
    if (minD && d < minD) return false;
    if (maxD && d > maxD) return false;
    return true;
  }

  function changeMonth(delta: number) {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) { m = 11; y -= 1; } else if (m > 11) { m = 0; y += 1; }
    setViewMonth(m);
    setViewYear(y);
  }

  function pick(d: Date) {
    if (!inRange(d)) return;
    onChange(toISO(d));
    setOpen(false);
  }

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(viewYear, viewMonth, d));

  const today = new Date();

  return (
    <div className="dp" ref={boxRef}>
      <button
        type="button"
        className="inp dp-trigger"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ color: value ? "var(--charcoal)" : "var(--muted)" }}>
          {selected ? selected.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : placeholder}
        </span>
        <Icon name="cal" className="cal-ic" />
      </button>
      {open && (
        <div className="dp-panel">
          <div className="dp-hd">
            <button type="button" className="dp-nav" onClick={() => changeMonth(-1)} aria-label="Previous month">‹</button>
            <b>{MONTHS[viewMonth]} {viewYear}</b>
            <button type="button" className="dp-nav" onClick={() => changeMonth(1)} aria-label="Next month">›</button>
          </div>
          <div className="dp-grid dp-dow">
            {DOW.map((l, i) => <span key={i}>{l}</span>)}
          </div>
          <div className="dp-grid">
            {cells.map((d, i) => {
              if (!d) return <span key={i} />;
              const isSel = !!selected && sameDay(d, selected);
              const isToday = sameDay(d, today);
              const blocked = !inRange(d);
              return (
                <button
                  type="button"
                  key={i}
                  className={`dp-day${isSel ? " sel" : ""}${isToday && !isSel ? " today" : ""}`}
                  disabled={blocked}
                  onClick={() => pick(d)}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          <div className="dp-ft">
            <button type="button" className="btn plain sm" onClick={() => pick(new Date())}>Today</button>
          </div>
        </div>
      )}
    </div>
  );
}
