"use client";

import { useModal } from "@/common/components/ModalProvider";
import { useAuth } from "@/common/providers/AuthProvider";
import { Icon } from "@/common/components/Icon";
import { LEDGER_EDITABLE_TYPES, useLoanEntryActions } from "@/modules/cash/components/useLoanEntryActions";
import { fmt, fmtDate } from "@/common/utils/format";
import { type LedgerRowView } from "@/modules/cash/types/cash-types";
import { BillLink } from "@/modules/cash/components/BillLink";

type RowInfoModalContentProps = { row: LedgerRowView; onChanged?: () => void };

/* The info popup for a ledger row with no cash movement behind it (a loan or
 * personal-loan payment, an opening row…): it can't load an entry, so it shows
 * what the row itself carries. */
export function RowInfoModalContent({ row, onChanged }: RowInfoModalContentProps) {
  const { closeModal } = useModal();
  const { can } = useAuth();
  const loanActions = useLoanEntryActions(onChanged);
  // A gold-loan repayment (or its discount) is corrected or deleted from here: the loan is recalculated.
  const loanRow = !!row.loanId && !!row.paymentId && LEDGER_EDITABLE_TYPES.includes(row.type);
  const canEdit = loanRow && can("Loan_Management", "can_edit_ledger_entry");
  const canDelete = loanRow && can("Loan_Management", "can_delete_ledger_entry");
  // A personal-loan payment: edited or deleted from its own record. An Interest / Penal Interest Charged row is
  // derived from the gold loan's sanction and rate: it offers the sanction editor.
  const personalRow = !!row.personalLoanId && !!row.paymentId;
  const canEditPersonal = personalRow && can("Loan_Management", "can_edit_ledger_entry");
  const canDeletePersonal = personalRow && can("Loan_Management", "can_delete_ledger_entry");
  const accrualRow = !!row.loanAccrual && !!row.loanId;
  const canEditSanction = accrualRow && can("Loan_Management", "can_edit_ledger_entry");
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
        <h4 style={{ margin: "18px 0 6px", fontSize: 13 }}>Description</h4>
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", fontSize: 13.5, whiteSpace: "pre-wrap", minHeight: 40 }}>
          {row.description || row.type || "—"}
        </div>
        {accrualRow && (
          <p style={{ margin: "14px 0 0", fontSize: 12.5, color: "var(--muted)" }}>This charge is calculated from the loan&apos;s sanction and rate — change it by editing the sanction.</p>
        )}
        {row.receiptImage ? (
          <p style={{ margin: "16px 0 0", fontSize: 13 }}>Bill:<BillLink url={row.receiptImage} title={row.type || "Entry"} /></p>
        ) : null}
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Close</button>
        {canDelete && <button className="btn ghost" style={{ color: "var(--red)" }} onClick={() => void loanActions.payment(row.loanId!, row.paymentId!, "delete")}><Icon name="trash" /> Delete</button>}
        {canEdit && <button className="btn" onClick={() => void loanActions.payment(row.loanId!, row.paymentId!, "edit")}><Icon name="edit" /> Edit</button>}
        {canDeletePersonal && <button className="btn ghost" style={{ color: "var(--red)" }} onClick={() => void loanActions.personalPayment(row.personalLoanId!, row.paymentId!, "delete")}><Icon name="trash" /> Delete</button>}
        {canEditPersonal && <button className="btn" onClick={() => void loanActions.personalPayment(row.personalLoanId!, row.paymentId!, "edit")}><Icon name="edit" /> Edit</button>}
        {canEditSanction && <button className="btn" onClick={() => void loanActions.sanction(row.loanId!)}><Icon name="edit" /> Edit sanction</button>}
      </div>
    </>
  );
}
