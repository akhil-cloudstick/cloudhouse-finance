"use client";

import { useData } from "@/lib/DataProvider";
import { custOf, fmt, schemeOf } from "@/lib/format";
import { StatusChip } from "./StatusChip";
import type { Loan } from "@/lib/data";

/* Ported from legacy/app.js's `loanRow(l)` — the shared row-builder used by
 * both the Customer 360° loan history table and (later) the Loans page. */
export function LoanRow({ loan: l }: { loan: Loan }) {
  const { db } = useData();
  const c = custOf(db, l.cust);
  const scheme = schemeOf(db, l.scheme);

  return (
    <tr className="click" onClick={() => { location.hash = "loan/" + l.id; }}>
      <td><span className="id">{l.id}</span><span className="sub">{c.name}</span></td>
      <td>{scheme.name}</td>
      <td>{l.opened}<span className="sub">due {l.due}</span></td>
      <td className="num">{fmt(l.principal)}</td>
      <td className="num">{l.outstanding ? fmt(l.outstanding) : "—"}</td>
      <td><StatusChip status={l.pledge} /></td>
      <td><StatusChip status={l.status} /></td>
    </tr>
  );
}
