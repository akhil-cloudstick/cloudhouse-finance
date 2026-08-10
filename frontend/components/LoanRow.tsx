"use client";

import { fmt } from "@/lib/format";
import { StatusChip } from "./StatusChip";
import type { LoanView } from "@/lib/loansApi";

/* Ported from legacy/app.js's `loanRow(l)` — the shared row-builder used by
 * both the Customer 360° loan history table and the Loans page. Now reads
 * a real backend-backed LoanView instead of the mock Loan, which already
 * carries denormalized customer/scheme names — no lookup needed here. */
export function LoanRow({ loan: l }: { loan: LoanView }) {
  return (
    <tr className="click" onClick={() => { location.hash = "loan/" + l.id; }}>
      <td><span className="id">{l.id}</span><span className="sub">{l.customerName}</span></td>
      <td>{l.schemeName}</td>
      <td>{l.opened}<span className="sub">due {l.due}</span></td>
      <td className="num">{fmt(l.principal)}</td>
      <td className="num">{l.outstanding ? fmt(l.outstanding) : "—"}</td>
      <td><StatusChip status={l.bankPledgeStatus} /></td>
      <td><StatusChip status={l.status} /></td>
    </tr>
  );
}
