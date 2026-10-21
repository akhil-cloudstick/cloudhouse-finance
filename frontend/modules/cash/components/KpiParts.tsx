"use client";

import { fmt } from "@/common/utils/format";

type KpiPartsProps = { parts: [string, number][]; keepZero?: boolean };

export function KpiParts({ parts, keepZero }: KpiPartsProps) {
  const shown = keepZero ? parts : parts.filter(([, amt]) => amt !== 0);
  return (
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
