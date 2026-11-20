"use client";

import { fmt } from "@/common/utils/format";

type KpiPartsProps = { parts: [string, number][]; keepZero?: boolean };

/* Breaks a KPI's single total back out into the sources that fed it. Zero
 * buckets are dropped so a quiet day shows a short list rather than a wall of
 * "0"s; if every bucket is zero the whole block collapses to one dash. */
export function KpiParts({ parts, keepZero }: KpiPartsProps) {
  const shown = keepZero ? parts : parts.filter(([, amt]) => amt !== 0);
  return (
    // minmax(0,1fr) pins every row to the card's width. Each row is a
    // `.kpi-fit` — nowrap, so a long label + amount overflows its row, and
    // FitTextObserver then shrinks that row's font until both fit, rather than
    // the amount being clipped by .kpi's overflow:hidden.
    <div style={{ marginTop: 6, borderTop: "1px solid var(--line)", paddingTop: 6, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 2 }}>
      {shown.length ? shown.map(([label, amt]) => (
        <div key={label} className="kpi-fit" style={{ color: "var(--muted)" }}>
          <span>{label}</span>
          <span className="num" style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>{fmt(amt)}</span>
        </div>
      )) : <div style={{ fontSize: 11.5, color: "var(--muted)" }}>No movements today</div>}
    </div>
  );
}
