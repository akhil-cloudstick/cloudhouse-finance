"use client";

import { fmt, fmtDate } from "@/common/utils/format";

export type InstalmentChangeView = { sequenceNo: number; dueDate: string; paidBefore: number; paidAfter: number; statusBefore: string; statusAfter: string };

/* The instalments an edit changes. What each has been paid follows from the payments, so this is shown for
 * information only — not editable. */
export function InstalmentChangesTable({ changes }: { changes: InstalmentChangeView[] }) {
  if (!changes.length) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <label className="f">Instalments worked out again</label>
      <p className="ccheck-hint" style={{ margin: "0 0 8px" }}>Worked out automatically from the edit — shown for checking, not editable.</p>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>#</th><th>Due</th><th className="num">Paid before</th><th className="num">Paid after</th><th>Status</th></tr></thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.sequenceNo}>
              <td>{c.sequenceNo}</td>
              <td>{fmtDate(c.dueDate)}</td>
              <td className="num">{fmt(c.paidBefore)}</td>
              <td className="num" style={{ fontWeight: 600 }}>{fmt(c.paidAfter)}</td>
              <td>{c.statusBefore === c.statusAfter ? c.statusAfter : `${c.statusBefore} → ${c.statusAfter}`}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}
