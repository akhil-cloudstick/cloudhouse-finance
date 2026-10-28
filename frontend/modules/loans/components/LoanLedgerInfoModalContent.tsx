"use client";

import { useModal } from "@/common/components/ModalProvider";
import { Icon } from "@/common/components/Icon";

export type LedgerInfoAction = {
  label: string;
  icon: "edit" | "trash";
  danger?: boolean;
  run: () => void; // opens the editor on top of this popup (useModal().openChildModal)
};

type Props = {
  title: string;
  // e.g. "Credit · Partial" — the small heading above the details
  kind: string;
  rows: [string, React.ReactNode][];
  // What the entry's Particulars cell says, in full: "Interest ₹335.32 · Principal ₹94,147.20", the fee charged, …
  description: React.ReactNode;
  actions: LedgerInfoAction[];
};

/* The info popup for one entry of a loan's Payment Ledger. Edit and Delete live here, not in the table: the editor
 * opens on top of this popup, and closing it brings the popup back. */
export function LoanLedgerInfoModalContent({ title, kind, rows, description, actions }: Props) {
  const { closeModal } = useModal();
  return (
    <>
      <div className="hd"><h3>{title}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".06em", color: "var(--brand-deep, #423591)", margin: "0 0 12px" }}>{kind.toUpperCase()}</p>
        <div className="kv">
          {rows.map(([k, v]) => (
            <div className="i" key={k}><div className="k">{k}</div><div className="v">{v}</div></div>
          ))}
        </div>
        <h4 style={{ margin: "18px 0 6px", fontSize: 13 }}>Description</h4>
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", fontSize: 13.5, minHeight: 40 }}>{description}</div>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Close</button>
        {actions.map((a) => (
          <button key={a.label} className={a.danger ? "btn ghost" : "btn"} style={a.danger ? { color: "var(--red)" } : undefined} onClick={a.run}>
            <Icon name={a.icon} /> {a.label}
          </button>
        ))}
      </div>
    </>
  );
}
