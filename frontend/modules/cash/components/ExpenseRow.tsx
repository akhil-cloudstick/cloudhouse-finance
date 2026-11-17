"use client";

import { Icon } from "@/common/components/Icon";
import { fmt, fmtDate } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { LedgerRefLink } from "@/common/components/LedgerRefLink";
import { type ExpenseView } from "@/modules/cash/types/cash-types";
import { useShowBranch } from "@/common/hooks/use-branch-switch";

type ExpenseRowProps = {
  e: ExpenseView; categoryId?: number;
  canApprove: boolean; awaiting?: string; busy: boolean; onApprove: () => void; onReject: () => void;
  // Opens the info popup: every column, the additional information, the receipt preview and Edit.
  onInfo: () => void;
};


/* canApprove/onApprove/onReject drive the Approve/Reject pair shown on a
 * Pending row (the expense approval flow) — shown only to the role of the
 * step the expense waits at (or Administrator); awaiting names that role. */
export function ExpenseRow({ e, categoryId, canApprove, awaiting, busy, onApprove, onReject, onInfo }: ExpenseRowProps) {
  const showBranch = useShowBranch();
  return (
    <tr data-ledger-key={`e-${e.id}`} data-ledger-date={e.d} data-ledger-amount={e.amt} data-ledger-ref={`e:${e.id}`}>
      <td data-label="Date">{fmtDate(e.d)}</td>
      <td data-label="Category">
        {categoryId ? <LedgerRefLink kind="category" id={categoryId} label={e.cat} /> : e.cat}
      </td>
      <td className="num" data-label="Amount">{fmt(e.amt)}</td>
      <td data-label="Mode">{e.mode}</td>
      {showBranch && <td data-label="Branch">{e.branch}</td>}
      <td data-label="Status">
        <StatusChip status={e.status} />
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
      <td data-label="Info" style={{ textAlign: "center" }}>
        <span className="ledger-info" style={{ right: "50%", transform: "translate(50%, -50%)" }}><button type="button" title="Details" aria-label="Expense details" style={{ border: 0, background: "none", cursor: "pointer", padding: 0, color: "var(--muted)", display: "inline-flex", alignItems: "center" }} onClick={onInfo}><Icon name="info" /></button></span>
      </td>
    </tr>
  );
}
