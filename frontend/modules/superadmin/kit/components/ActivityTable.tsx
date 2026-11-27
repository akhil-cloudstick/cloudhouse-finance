import { TruncText } from "./TruncText";

/** One console action as the activity log shows it. */
export type ActivityRow = {
  id: number | string;
  createdAt: string;
  actor: string;
  action: string;
  /** Shown only when the table lists several businesses. */
  business?: string | undefined;
  detail: string;
  reason?: string | undefined;
};

/** The console's activity / audit log table, the same in every console: when, who, what, (which business), detail, why. */
export function ActivityTable({ rows, showBusiness, emptyText }: { rows: ActivityRow[]; showBusiness?: boolean | undefined; emptyText: string }) {
  const cols = showBusiness ? 6 : 5;
  return (
    <div className="sa-table-wrap">
      <table className="sa-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Actor</th>
            <th>Action</th>
            {showBusiness && <th>Business</th>}
            <th>Detail</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{new Date(r.createdAt).toLocaleString()}</td>
              <td>{r.actor}</td>
              <td>{r.action}</td>
              {showBusiness && <td>{r.business || "—"}</td>}
              <td>{r.detail}</td>
              <td>
                <TruncText text={r.reason} />
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={cols} className="sa-empty">
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
