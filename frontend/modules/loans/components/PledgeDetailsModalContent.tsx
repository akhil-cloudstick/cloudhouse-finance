"use client";

import { useModal } from "@/common/components/ModalProvider";
import { fmt, fmtW, fmtDate } from "@/common/utils/format";
import { CASH_TREATMENT_LABELS } from "@/modules/loans/services/loanService";
import { type BankPledgeView } from "@/modules/loans/types/loan-types";

export type PledgeDetailsGridProps = { loanNumber: string; customerName?: string; pledge: BankPledgeView; ornamentNames: string[] };

/* Read-only summary of one re-pledge — shown on its own (View) and above the
 * release confirmation, so the admin sees interest, due date and what is being
 * handed back before releasing the gold. */
export function PledgeDetailsGrid({ loanNumber, customerName, pledge, ornamentNames }: PledgeDetailsGridProps) {
  const overdue = !!pledge.bankPledgeDueDate && new Date(pledge.bankPledgeDueDate) < new Date(new Date().toDateString());
  const rows: [string, React.ReactNode][] = [
    ["Loan", loanNumber],
    ["Customer", customerName || "—"],
    ["Bank", pledge.bankName || "—"],
    ["Pledged amount", fmt(pledge.pledgedAmount)],
    ["Interest rate", pledge.bankInterestRate ? `${pledge.bankInterestRate}% p.m.` : "—"],
    ["Pledged on", fmtDate(pledge.pledgeDate)],
    ["Due date", pledge.bankPledgeDueDate ? <>{fmtDate(pledge.bankPledgeDueDate)}{overdue && <span className="pill red" style={{ marginLeft: 8 }}>Overdue</span>}</> : "—"],
    ["Reference no.", pledge.referenceNumber || "—"],
    ["Cash treatment", CASH_TREATMENT_LABELS[pledge.cashTreatment === "CashIn" ? "CashIn" : "RecordOnly"]],
    ["Gross weight", fmtW(pledge.pledgedGrossWeight)],
    ["Net weight", fmtW(pledge.pledgedNetWeight)],
    ["Ornaments", ornamentNames.length ? ornamentNames.join(", ") : "All ornaments"],
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 16px", fontSize: 13.5, marginBottom: 14 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <span style={{ color: "var(--muted)" }}>{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}

type PledgeDetailsModalContentProps = PledgeDetailsGridProps & { onRelease?: () => void };

export function PledgeDetailsModalContent({ onRelease, ...grid }: PledgeDetailsModalContentProps) {
  const { closeModal } = useModal();
  return (
    <>
      <div className="hd"><h3>Re-Pledge Details</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll"><PledgeDetailsGrid {...grid} /></div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Close</button>
        {onRelease && <button className="btn" onClick={onRelease}>Release…</button>}
      </div>
    </>
  );
}
