"use client";

import { fmt, fmtDate } from "@/common/utils/format";
import { TableCols } from "@/common/components/ui/TableCols";

export type InterestChangeView = { on: string; interestBefore: number; interestAfter: number; penalBefore: number; penalAfter: number };

/* The interest charges an edit changes. They are worked out by the system from the loan's terms and balances, so they
 * are shown for information only — not editable. */
export function InterestChangesTable({ changes }: { changes: InterestChangeView[] }) {
  if (!changes.length) return null;
  const anyPenal = changes.some((c) => c.penalBefore || c.penalAfter);
  return (
    <div style={{ marginTop: 14 }}>
      <label className="f">Interest worked out again</label>
      <p className="ccheck-hint" style={{ margin: "0 0 8px" }}>Worked out automatically from the edit — shown for checking, not editable.</p>
      <div className="tbl-wrap"><table className="tbl"><TableCols widths={[22, 26, 26, ...(anyPenal ? [13, 13] : [])]} />
        <thead><tr><th>Charged on</th><th className="num">Interest before</th><th className="num">Interest after</th>{anyPenal && <><th className="num">Penal before</th><th className="num">Penal after</th></>}</tr></thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.on}>
              <td>{fmtDate(c.on)}</td>
              <td className="num">{fmt(c.interestBefore)}</td>
              <td className="num" style={{ fontWeight: 600 }}>{fmt(c.interestAfter)}</td>
              {anyPenal && <><td className="num">{fmt(c.penalBefore)}</td><td className="num" style={{ fontWeight: 600 }}>{fmt(c.penalAfter)}</td></>}
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}
