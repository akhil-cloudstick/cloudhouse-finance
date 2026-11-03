"use client";

import { TableCols } from "@/common/components/ui/TableCols";
import { useModal } from "@/common/components/ModalProvider";
import { fmt, fmtDate } from "@/common/utils/format";
import { type LedgerRowView } from "@/modules/cash/types/cash-types";
import { BillLink } from "@/modules/cash/components/BillLink";

type RowInfoModalContentProps = { row: LedgerRowView; onChanged?: () => void };

/* The info popup for a ledger row with no cash movement behind it (a loan or
 * personal-loan payment, an opening row…): it can't load an entry, so it shows
 * what the row itself carries. */
export function RowInfoModalContent({ row }: RowInfoModalContentProps) {
  const { closeModal } = useModal();
  // Loan repayments, the sanction and the loan's other records are edited from their own ledger, not from here.
  const accrualRow = !!row.loanAccrual && !!row.loanId;
  const item = (k: string, v: React.ReactNode) => (
    <div className="i"><div className="k">{k}</div><div className="v">{v}</div></div>
  );
  return (
    <>
      <div className="hd"><h3>Entry Details</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".06em", color: "var(--brand-deep, #423591)", margin: "0 0 12px" }}>
          {(row.debitOrCredit === "debit" ? "Debit" : "Credit").toUpperCase()}{row.type ? ` · ${row.type.toUpperCase()}` : ""}
        </p>
        <div className="kv">
          {item("Date", fmtDate(row.d))}
          {item("Amount", fmt(row.amount))}
          {item("Mode", row.method || "—")}
          {row.reference ? item("Reference", row.reference) : null}
          {row.customerName ? item("Customer", row.customerName) : null}
          {row.bankName ? item("Bank", row.bankName) : null}
          {item("Balance", fmt(row.runningBalance))}
        </div>
        {row.split && row.split.length > 0 && (
          <>
            <h4 style={{ margin: "18px 0 6px", fontSize: 13 }}>Paid towards</h4>
            <div className="tbl-wrap"><table className="tbl">
              <TableCols widths={[35, 35, 30]} />
              <thead><tr><th>Part</th><th>Mode</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {row.split.map((ln, i) => (
                  <tr key={`${ln.label}-${ln.mode ?? ""}-${i}`}>
                    <td>{ln.label}</td>
                    <td>{ln.mode || "—"}</td>
                    <td className="num">{fmt(ln.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </>
        )}
        <h4 style={{ margin: "18px 0 6px", fontSize: 13 }}>Description</h4>
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", fontSize: 13.5, whiteSpace: "pre-wrap", minHeight: 40 }}>
          {row.description || row.type || "—"}
        </div>
        {accrualRow && (
          <p style={{ margin: "14px 0 0", fontSize: 12.5, color: "var(--muted)" }}>This charge is calculated from the loan&apos;s sanction and rate — it cannot be edited on its own.</p>
        )}
        {row.receiptImage ? (
          <p style={{ margin: "16px 0 0", fontSize: 13 }}>Bill:<BillLink url={row.receiptImage} title={row.type || "Entry"} /></p>
        ) : null}
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Close</button>
      </div>
    </>
  );
}
