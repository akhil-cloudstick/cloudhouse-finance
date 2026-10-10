"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/common/components/Icon";
import { fmtDate } from "@/common/utils/format";

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

type DatePickerProps = {
  value: string; // "YYYY-MM-DD"
  onChange: (v: string) => void;
  placeholder?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
};

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
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"days" | "years">("days");
  const selected = parseISO(value);
  const [viewYear, setViewYear] = useState(() => (selected || new Date()).getFullYear());
  const [viewMonth, setViewMonth] = useState(() => (selected || new Date()).getMonth());
  // Anchors the visible 12-year block in year-picker mode; kept separate from
  // viewYear so paging through decades doesn't jump the day grid around.
  const [decadeStart, setDecadeStart] = useState(() => Math.floor(((selected || new Date()).getFullYear()) / 12) * 12);
  const boxRef = useRef<HTMLDivElement>(null);
  // The panel is positioned `fixed` (viewport-relative) rather than
  // `absolute` inside `.dp`, because `.dp` usually sits inside a scrollable
  // `.modal-bg` — an absolutely-positioned descendant that pokes past the
  // modal's bottom edge still counts toward that ancestor's scrollable
  // overflow, so the whole modal grew/scrolled taller just from opening the
  // calendar. `fixed` positioning escapes that containing block entirely, so
  // it needs its own on-open + scroll/resize coordinates from the trigger.
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // Jump the visible month back to the selected (or current) date every time
  // the popover is (re)opened, rather than remembering wherever it was left.
  useEffect(() => {
    if (!open) return;
    const d = parseISO(value) || new Date();
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    setDecadeStart(Math.floor(d.getFullYear() / 12) * 12);
    setMode("days");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    function updatePos() {
      const el = boxRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPanelPos({ top: r.bottom + 6, left: r.left, width: r.width });
    }
    updatePos();
    // Closes on scroll instead of repositioning — see Select.tsx's identical
    // fix for why a `position:fixed` panel re-anchored mid-scroll reads as a
    // floating, detached dropdown instead of tracking its trigger smoothly.
    function closeOnScroll() {
      setOpen(false);
    }
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open]);

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
    <div className="dp dp-date" ref={boxRef}>
      <button
        type="button"
        className="inp dp-trigger"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ color: value ? "var(--nav)" : "var(--muted)" }}>
          {selected ? fmtDate(toISO(selected)) : placeholder}
        </span>
        <Icon name="cal" className="cal-ic" />
      </button>
      {open && panelPos && (
        <div
          className="dp-panel dp-panel-fixed"
          style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width }}
        >
          {/* Both sub-views stay mounted at all times (hidden via CSS rather
              than left out of the tree) — switching `mode` used to swap
              which branch was rendered, which meant the button the user had
              just clicked (e.g. the month/year title) was removed from the
              DOM as part of the very click that removed it. React 18 can
              commit that removal before the native click event finishes
              bubbling to this component's own "outside click" listener on
              `document`, so by the time that listener ran, `e.target` was
              already detached and no longer read as "inside" the picker —
              every mode switch looked like a click outside and closed the
              whole popover. Keeping both subtrees permanently mounted means
              no click can ever remove its own target node. */}
          <div className={`dp-view${mode === "years" ? " dp-hidden" : ""}`}>
            <div className="dp-hd">
              <button type="button" className="dp-nav" onClick={() => changeMonth(-1)} aria-label="Previous month">‹</button>
              <button type="button" className="dp-title" onClick={() => setMode("years")}>
                {MONTHS[viewMonth]} {viewYear}
              </button>
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
          <div className={`dp-view${mode === "days" ? " dp-hidden" : ""}`}>
            <div className="dp-hd">
              <button type="button" className="dp-nav" onClick={() => setDecadeStart((y) => y - 12)} aria-label="Previous years">‹</button>
              <b>{decadeStart} – {decadeStart + 11}</b>
              <button type="button" className="dp-nav" onClick={() => setDecadeStart((y) => y + 12)} aria-label="Next years">›</button>
            </div>
            <div className="dp-grid dp-years">
              {Array.from({ length: 12 }, (_, i) => decadeStart + i).map((y) => {
                const isSel = y === viewYear;
                const isThisYear = y === today.getFullYear();
                const blocked = (minD && y < minD.getFullYear()) || (maxD && y > maxD.getFullYear());
                return (
                  <button
                    type="button"
                    key={y}
                    className={`dp-year${isSel ? " sel" : ""}${isThisYear && !isSel ? " today" : ""}`}
                    disabled={!!blocked}
                    onClick={() => { setViewYear(y); setMode("days"); }}
                  >
                    {y}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
