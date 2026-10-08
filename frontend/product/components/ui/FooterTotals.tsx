"use client";

import { fmt } from "@/product/utils/format";

/* Right-aligned totals for a table card's `.ft` footer bar (next to the
 * pager) — always the server's sum over every row matching the filters,
 * never just the loaded page. */
/* aligned: for a ledger table with Debit / Credit / Balance columns — the two
 * totals render in fixed-width slots matching those columns (see
 * .tbl.ledger-amt in app.css), so each total sits under its own column. */
export function FooterTotals({ items, aligned }: { items: { label?: string; value: number; color?: string }[]; aligned?: boolean }) {
  if (aligned) {
    // .ft has 18px of right padding; the table runs to the card edge.
    const slot = { width: 140, boxSizing: "border-box" as const, padding: "0 14px", textAlign: "right" as const, whiteSpace: "nowrap" as const };
    return (
      <div style={{ marginLeft: "auto", marginRight: -18, display: "flex", alignItems: "center", fontSize: 12.5 }}>
        {items.slice(0, 2).map((t) => (
          <span key={t.color ?? t.label} style={slot}>
            <b style={{ color: t.color || "var(--ink, inherit)", fontSize: 13.5 }}>{fmt(t.value)}</b>
          </span>
        ))}
        <span style={slot} />
      </div>
    );
  }
  return (
    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", fontSize: 12.5 }}>
      {items.map((t) => (
        <span key={`${t.label ?? ""}${t.color ?? ""}`} style={{ color: "var(--muted)" }}>
          {t.label ? `${t.label} ` : null}<b style={{ color: t.color || "var(--ink, inherit)", fontSize: 13.5 }}>{fmt(t.value)}</b>
        </span>
      ))}
    </div>
  );
}
