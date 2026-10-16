"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { fmt } from "@/common/utils/format";

type FooterTotalsProps = { items: { label?: string; value: number; color?: string }[]; aligned?: boolean };
type Slot = { left: number; width: number; align: "left" | "center" | "right" };

/* Right-aligned totals for a table card's `.ft` footer bar (next to the
 * pager) — always the server's sum over every row matching the filters,
 * never just the loaded page. */
/* aligned: for a ledger table with Debit / Credit / Balance columns — each
 * total is placed under its own column. The column's real position and text
 * alignment are measured from the table (centred in the loan ledger,
 * right-aligned in the others), so the totals stay level with the figures
 * above them whatever the column widths turn out to be. Until measured (and
 * for stacked cards, which have no columns) fixed-width slots are used. */
export function FooterTotals({ items, aligned }: FooterTotalsProps) {
  if (aligned) return <AlignedTotals items={items} />;
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

function measureSlots(box: HTMLElement): Slot[] | null {
  const table = box.closest(".card")?.querySelector<HTMLTableElement>("table.ledger-amt");
  if (!table || table.classList.contains("tbl-stack") && window.innerWidth <= 1279) return null;
  const heads = table.querySelectorAll<HTMLElement>("thead th.num");
  if (heads.length < 2) return null;
  const boxLeft = box.getBoundingClientRect().left;
  const out: Slot[] = [];
  for (let i = 0; i < 2; i++) {
    const th = heads[i];
    const index = Array.from(th.parentElement!.children).indexOf(th);
    const cell = table.querySelector<HTMLElement>(`tbody tr:not(:has(td.empty)) td:nth-child(${index + 1})`) ?? th;
    const cs = getComputedStyle(cell);
    const r = th.getBoundingClientRect();
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const align = cs.textAlign === "center" ? "center" : cs.textAlign === "left" || cs.textAlign === "start" ? "left" : "right";
    out.push({ left: r.left + padL - boxLeft, width: Math.max(r.width - padL - padR, 0), align });
  }
  return out;
}

function AlignedTotals({ items }: { items: FooterTotalsProps["items"] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const table = box.closest(".card")?.querySelector("table.ledger-amt");
    const update = () => {
      const next = measureSlots(box);
      setSlots((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(box);
    if (table) ro.observe(table);
    window.addEventListener("resize", update);
    return () => { ro.disconnect(); window.removeEventListener("resize", update); };
  });

  // Fixed fallback: .ft has 18px of right padding; the table runs to the card edge.
  const slot = { width: "var(--ledger-amt-w, 140px)", boxSizing: "border-box" as const, padding: "0 14px", textAlign: "right" as const, whiteSpace: "nowrap" as const };
  const shown = items.slice(0, 2);
  if (slots) {
    return (
      <div ref={boxRef} style={{ position: "relative", flex: "1 1 auto", alignSelf: "stretch", minHeight: 22, fontSize: 12.5 }}>
        {shown.map((t, i) => (
          <span key={t.color ?? t.label} style={{ position: "absolute", top: "50%", transform: "translateY(-50%)", left: slots[i].left, width: slots[i].width, textAlign: slots[i].align, whiteSpace: "nowrap" }}>
            <b className="ledger-total-fit" style={{ color: t.color || "var(--ink, inherit)", fontSize: 13.5 }}>{fmt(t.value)}</b>
          </span>
        ))}
      </div>
    );
  }
  return (
    <div ref={boxRef} className="ft-tot-aligned" style={{ marginLeft: "auto", marginRight: -18, display: "flex", alignItems: "center", fontSize: 12.5 }}>
      {shown.map((t) => (
        <span key={t.color ?? t.label} className="ft-tot-slot" style={slot}>
          <b className="ledger-total-fit" style={{ color: t.color || "var(--ink, inherit)", fontSize: 13.5 }}>{fmt(t.value)}</b>
        </span>
      ))}
      <span className="ft-tot-spacer" style={{ ...slot, width: "var(--ledger-bal-w, 140px)" }} />
    </div>
  );
}
