"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { Icon } from "@/common/components/Icon";
import { fmt, fmtDate, fmtDateTime } from "@/common/utils/format";
import { getMovementEntry } from "@/modules/cash/services/cashService";
import { type EntryInfo, type EntryKind } from "@/modules/cash/types/cash-types";
import { BillLink } from "@/modules/cash/components/BillLink";
import { EditEntryModalContent } from "@/modules/cash/components/EditEntryModalContent";

const KIND_LABEL: Record<EntryKind, string> = {
  cash_in: "Credit (Cash In)",
  debit: "Debit (Expense)",
  self_transfer: "Self Transfer",
  gold_sale: "Gold Sale",
};

type EntryInfoModalContentProps = { entryId: number; onChanged?: () => void };

/* The ledger's info popup for a cash-in, a debit or a self transfer: its
 * remarks and everything recorded about it — category, amount, date, the
 * payment breakdown (or the From / To banks of a transfer), branch, bill. */
export function EntryInfoModalContent({ entryId, onChanged }: EntryInfoModalContentProps) {
  const { closeModal, openModal } = useModal();
  const [info, setInfo] = useState<EntryInfo | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    getMovementEntry(entryId)
      .then((i) => { if (!cancelled) setInfo(i); })
      .catch(() => { if (!cancelled) setErr("Could not load the details of this entry."); });
    return () => { cancelled = true; };
  }, [entryId]);

  if (!info) {
    return (
      <>
        <div className="hd"><h3>Entry Details</h3><button className="x" onClick={closeModal}>×</button></div>
        <div className="bd"><p style={{ color: err ? "var(--red)" : "var(--muted)", fontSize: 13 }}>{err || "Loading…"}</p></div>
      </>
    );
  }

  const isTransfer = info.kind === "self_transfer";
  const item = (k: string, v: React.ReactNode) => (
    <div className="i"><div className="k">{k}</div><div className="v">{v}</div></div>
  );

  return (
    <>
      <div className="hd"><h3>Entry Details</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".06em", color: "var(--brand-deep, #423591)", margin: "0 0 12px" }}>{KIND_LABEL[info.kind].toUpperCase()}</p>
        <div className="kv">
          {item("Category", info.category || "—")}
          {info.ornamentType ? item("Ornament", info.ornamentType) : null}
          {info.kind === "gold_sale" ? item("Cost", fmt(info.costAmount ?? 0)) : null}
          {item("Amount", fmt(info.amount))}
          {item("Date", fmtDate(info.occurredOn))}
          {info.branchName ? item("Branch", info.branchName) : null}
          {info.status ? item("Status", info.status) : null}
          {info.approvedBy ? item("Approved by", info.approvedBy) : null}
          {info.approvedAt ? item("Approved on", fmtDateTime(info.approvedAt)) : null}
        </div>

        <h4 style={{ margin: "18px 0 6px", fontSize: 13 }}>Remarks</h4>
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", fontSize: 13.5, whiteSpace: "pre-wrap", minHeight: 40, color: info.remarks ? undefined : "var(--muted)" }}>
          {info.remarks || "No remarks were added to this entry."}
        </div>

        {isTransfer ? (
          <>
            <h4 style={{ margin: "18px 0 6px", fontSize: 13 }}>Transfer</h4>
            <div className="kv">
              {item("Mode", info.lines[0]?.mode || "—")}
              {item("From bank", info.fromBank || "—")}
              {item("To bank", info.toBank || "—")}
            </div>
          </>
        ) : (
          <>
            <h4 style={{ margin: "18px 0 6px", fontSize: 13 }}>Payment breakdown</h4>
            <table className="tbl" style={{ width: "100%" }}>
              <thead><tr><th>Mode</th><th>Bank</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {info.lines.map((l) => (
                  <tr key={l.movementId}><td>{l.mode}</td><td>{l.bankName || "—"}</td><td className="num">{fmt(l.amount)}</td></tr>
                ))}
                {info.lines.length > 1 && (
                  <tr><td colSpan={2} style={{ fontWeight: 600 }}>Total</td><td className="num" style={{ fontWeight: 600 }}>{fmt(info.amount)}</td></tr>
                )}
              </tbody>
            </table>
          </>
        )}

        {info.receiptImage ? (
          <p style={{ margin: "16px 0 0", fontSize: 13 }}>Bill:<BillLink url={info.receiptImage} title={info.category || "Entry"} /></p>
        ) : null}
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Close</button>
        {info.editable && (
          <button className="btn" onClick={() => openModal(<EditEntryModalContent entryId={entryId} info={info} onSaved={onChanged} />)}>
            <Icon name="edit" /> Edit
          </button>
        )}
      </div>
    </>
  );
}
