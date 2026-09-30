"use client";

import { fmt } from "@/common/utils/format";

/* Right-aligned totals for a table card's `.ft` footer bar (next to the
 * pager) — always the server's sum over every row matching the filters,
 * never just the loaded page. */
export function FooterTotals({ items }: { items: { label: string; value: number; color?: string }[] }) {
  return (
    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", fontSize: 12.5 }}>
      {items.map((t) => (
        <span key={t.label} style={{ color: "var(--muted)" }}>
          {t.label} <b style={{ color: t.color || "var(--ink, inherit)", fontSize: 13.5 }}>{fmt(t.value)}</b>
        </span>
      ))}
    </div>
  );
}
