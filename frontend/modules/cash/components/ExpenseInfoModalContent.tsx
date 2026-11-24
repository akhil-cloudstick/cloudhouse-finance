"use client";

import { useModal } from "@/common/components/ModalProvider";
import { Icon } from "@/common/components/Icon";
import { SafeImage } from "@/common/components/ui/SafeImage";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { fmt, fmtDate } from "@/common/utils/format";
import { type ExpenseView } from "@/modules/cash/types/cash-types";

// System note the backend stamps on bank pledge release expenses; not shown to users.
const SYSTEM_REMARK = "Auto-recorded from bank pledge workflow";

type Props = {
  e: ExpenseView;
  showBranch: boolean;
  // Offered only when the expense can be edited (directly, or through its bank pledge).
  onEdit?: () => void;
  // Offered only when the user may delete this expense (same rule as the row's Delete button).
  onDelete?: () => void;
};

/* The info popup for one row of the Expense Register: every table column, the additional information, the receipt
 * preview and Edit. The table itself stays compact — the remarks and the receipt live only here. */
export function ExpenseInfoModalContent({ e, showBranch, onEdit, onDelete }: Props) {
  const { closeModal } = useModal();
  const remarks = e.remarks && e.remarks !== SYSTEM_REMARK ? e.remarks : "";
  return (
    <>
      <div className="hd"><h3>Expense — {e.cat}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="kv">
          <div className="i"><div className="k">Date</div><div className="v">{fmtDate(e.d)}</div></div>
          <div className="i"><div className="k">Category</div><div className="v">{e.cat}</div></div>
          <div className="i"><div className="k">Amount</div><div className="v">{fmt(e.amt)}</div></div>
          <div className="i"><div className="k">Mode</div><div className="v">{e.mode}</div></div>
          {showBranch && <div className="i"><div className="k">Branch</div><div className="v">{e.branch}</div></div>}
          <div className="i"><div className="k">Status</div><div className="v"><StatusChip status={e.status} /></div></div>
          {e.approvedBy && e.approvedBy !== "System" && <div className="i"><div className="k">{e.status === "Rejected" ? "Rejected by" : "Approved by"}</div><div className="v">{e.approvedBy}</div></div>}
        </div>
        <h4 style={{ margin: "18px 0 6px", fontSize: 13 }}>Additional Information</h4>
        <div className="addl-info boxed">
          {remarks || <span style={{ color: "var(--muted)" }}>—</span>}
        </div>
        <h4 style={{ margin: "18px 0 6px", fontSize: 13 }}>Bill / Receipt</h4>
        {e.img
          ? <div style={{ textAlign: "center" }}><SafeImage src={e.img} style={{ maxWidth: "100%", maxHeight: "50vh", borderRadius: 8, border: "1px solid var(--line)" }} alt="Receipt" /></div>
          : <span style={{ color: "var(--muted)" }}>No receipt attached.</span>}
      </div>
      {(onEdit || onDelete) && (
        <div className="ft">
          {onDelete && <button className="btn ghost" style={{ color: "var(--red)" }} onClick={onDelete}><Icon name="trash" /> Delete</button>}
          {onEdit && <button className="btn" onClick={onEdit}><Icon name="edit" /> Edit</button>}
        </div>
      )}
    </>
  );
}
