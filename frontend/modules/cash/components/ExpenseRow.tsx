"use client";

import { SafeImage } from "@/common/components/ui/SafeImage";
import { Icon } from "@/common/components/Icon";
import { fmt, fmtDate } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { LedgerRefLink } from "@/common/components/LedgerRefLink";
import { type ExpenseView } from "@/modules/cash/types/cash-types";
import { useShowBranch } from "@/common/hooks/use-branch-switch";

type ExpenseRowProps = {
  e: ExpenseView; categoryId?: number; onViewReceipt: () => void;
  canApprove: boolean; awaiting?: string; busy: boolean; onApprove: () => void; onReject: () => void;
  // Opens the edit form — offered on a pending or approved expense a person keyed in.
  onEdit?: () => void;
};

/* canApprove/onApprove/onReject drive the Approve/Reject pair shown on a
 * Pending row (the expense approval flow) — shown only to the role of the
 * step the expense waits at (or Administrator); awaiting names that role. */
export function ExpenseRow({ e, categoryId, onViewReceipt, canApprove, awaiting, busy, onApprove, onReject, onEdit }: ExpenseRowProps) {
  const showBranch = useShowBranch();
  return (
    <tr data-ledger-key={`e-${e.id}`} data-ledger-date={e.d} data-ledger-amount={e.amt}>
      <td data-label="Date">{fmtDate(e.d)}</td>
      <td data-label="Category">
        {categoryId ? <LedgerRefLink kind="category" id={categoryId} label={e.cat} /> : e.cat}
      </td>
      <td className="num" data-label="Amount">{fmt(e.amt)}</td>
      <td data-label="Mode">{e.mode}</td>
      {showBranch && <td data-label="Branch">{e.branch}</td>}
      <td data-label="Status">
        <StatusChip status={e.status} />
        {e.remarks ? <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{e.remarks}</div> : null}
        {e.status === "Pending" && awaiting && !canApprove && (
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Awaiting {awaiting}</div>
        )}
        {e.status === "Pending" && canApprove && (
          <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 6 }}>
            <button className="btn sm" disabled={busy} onClick={onApprove}><Icon name="check" /> Approve</button>
            <button className="btn danger sm" disabled={busy} onClick={onReject}>Reject</button>
          </div>
        )}
      </td>
      <td data-label="Edit" style={{ textAlign: "center" }}>
        {e.editable && onEdit
          ? <button type="button" title="Edit expense" aria-label="Edit expense" onClick={onEdit} style={{ border: 0, background: "none", cursor: "pointer", padding: 2, color: "var(--muted)", display: "inline-flex", alignItems: "center" }}><Icon name="edit" /></button>
          : <span style={{ color: "var(--muted)" }}>—</span>}
      </td>
      <td data-label="Receipt" style={{ textAlign: "center" }}>
        {e.img
          ? <SafeImage src={e.img} style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)", cursor: "pointer", verticalAlign: "middle" }} title="View receipt" onClick={onViewReceipt} />
          : <span style={{ color: "var(--muted)" }}>—</span>}
      </td>
    </tr>
  );
}
