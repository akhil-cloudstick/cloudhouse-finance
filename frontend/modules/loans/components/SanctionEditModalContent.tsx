"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { FieldError } from "@/common/components/ui/FieldError";
import { SplitPaymentInput, type SplitAmounts, type SplitPaymentLine } from "@/common/components/SplitPaymentInput";
import { fmt } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { singleFlight } from "@/common/utils/singleFlight";
import { editLoanDisbursement, type LedgerEditPreview } from "@/modules/loans/services/loanService";
import { type PaymentView } from "@/modules/loans/types/loan-types";

type Props = {
  loanId: number;
  sanctionedAmount: number;
  serviceChargeAmount: number;
  disbursementDate: string;
  dueDate: string;
  payment?: PaymentView | null; // the Disbursement ledger row, when there is one
  onSaved: () => void;
};

// Two steps, like a payment edit: the first click previews what the change does to the loan (nothing is saved),
// the second click saves it at once. The loan is recalculated from its first day, so every later payment and
// top-up is allocated again; if one would no longer fit, the change is refused.
export function SanctionEditModalContent({ loanId, sanctionedAmount, serviceChargeAmount, disbursementDate, dueDate, payment: p, onSaved }: Props) {
  const { closeModal } = useModal();
  const toast = useToast();
  const [date, setDate] = useState(disbursementDate.slice(0, 10));
  const [due, setDue] = useState(dueDate.slice(0, 10));
  const [amount, setAmount] = useState(String(sanctionedAmount));
  const [charge, setCharge] = useState(String(serviceChargeAmount || 0));
  const payout = Math.max(0, (+amount || 0) - (+charge || 0));
  const startPayout = Math.max(0, sanctionedAmount - serviceChargeAmount);
  const initialLines: SplitPaymentLine[] = (p
    ? [
        p.cashAmount > 0 && { mode: "Cash" as const, amount: String(p.cashAmount) },
        p.upiAmount > 0 && { mode: "UPI" as const, amount: String(p.upiAmount), bankId: p.bankId ?? undefined },
        p.bankTransferAmount > 0 && { mode: "Bank Transfer" as const, amount: String(p.bankTransferAmount), bankId: p.bankId ?? undefined },
      ]
    : [{ mode: "Cash" as const, amount: String(startPayout) }]
  ).filter(Boolean) as SplitPaymentLine[];
  const [split, setSplit] = useState<SplitAmounts>({
    cashAmount: p ? p.cashAmount : startPayout, upiAmount: p?.upiAmount ?? 0,
    bankTransferAmount: p?.bankTransferAmount ?? 0, chequeAmount: 0,
  });
  const [remaining, setRemaining] = useState(0);
  const [bankId, setBankId] = useState<number | undefined>(p?.bankId ?? undefined);
  const [preview, setPreview] = useState<LedgerEditPreview | null>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  function changed(set: (v: string) => void) {
    return (v: string) => { setPreview(null); setErr(""); set(v); };
  }

  async function submit() {
    return singleFlight("modal:sanction-edit", async () => {
      const dry = preview == null;
      const amt = +amount;
      const chg = +charge || 0;
      if (!(amt > 0)) { setErr("Enter a valid sanctioned amount."); return; }
      if (chg < 0 || chg >= amt) { setErr("The service charge must be less than the sanctioned amount."); return; }
      if (Math.abs(remaining) > 0.01) { setErr(`The payout breakdown must add up to the amount paid out (${fmt(payout)}).`); return; }
      if ((split.upiAmount > 0 || split.bankTransferAmount > 0) && !bankId) { setErr("Select the bank for the UPI / Bank Transfer part."); return; }
      setSaving(true);
      try {
        const res = await editLoanDisbursement(loanId, {
          disbursedOn: date, dueDate: due, sanctionedAmount: amt, serviceCharge: chg,
          cashAmount: split.cashAmount, upiAmount: split.upiAmount, bankTransferAmount: split.bankTransferAmount, bankId,
        }, dry);
        if (dry) { setPreview(res); setErr(""); return; }
        toast("Sanction updated and the loan recalculated");
        onSaved();
        closeModal();
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : "Could not save the change — try again.");
        setPreview(null);
      } finally {
        setSaving(false);
      }
    });
  }

  const changedRow = (label: string, before: number, after: number) => (
    <tr>
      <td>{label}</td>
      <td className="num">{fmt(before)}</td>
      <td className="num" style={{ fontWeight: 600, color: Math.abs(after - before) > 0.005 ? "var(--brand)" : undefined }}>{fmt(after)}</td>
    </tr>
  );

  return (
    <>
      <div className="hd"><h3>Edit Loan Sanction</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll ledger-edit-bd">
        <p className="notice" style={{ marginBottom: 12 }}>
          This change is applied immediately (it is not sent back for approval). The loan is recalculated from its first
          day — principal, interest, due date, every later payment and top-up, and the cash ledger. It is refused if a
          later entry would no longer fit.
        </p>
        <div className="frow c2">
          <div><label className="f">Disbursement Date *</label><DatePicker value={date} max={today} onChange={changed(setDate)} /></div>
          <div><label className="f">Due Date *</label><DatePicker value={due} onChange={changed(setDue)} /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">Sanctioned Amount (₹) *</label><input className="inp" type="number" min={0} value={amount} onChange={(e) => changed(setAmount)(e.target.value)} /></div>
          <div><label className="f">Service Charge (₹)</label><input className="inp" type="number" min={0} value={charge} onChange={(e) => changed(setCharge)(e.target.value)} /></div>
        </div>
        <h4 style={{ margin: "14px 0 6px", fontSize: 13 }}>Payout breakdown <small style={{ fontWeight: 400, color: "var(--muted)" }}>Paid to the customer: {fmt(payout)}</small></h4>
        <SplitPaymentInput
          totalAmount={payout} initialLines={initialLines} scrollInternally={false} label={null}
          onChange={(s, r, b) => { setPreview(null); setErr(""); setSplit(s); setRemaining(r); setBankId(b); }}
        />
        {preview && (
          <div style={{ marginTop: 12 }}>
            <label className="f">What changes on the loan (as of its last entry)</label>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th></th><th className="num">Before</th><th className="num">After</th></tr></thead>
              <tbody>
                {changedRow("Principal owed", preview.before.principal, preview.after.principal)}
                {changedRow("Interest owed", preview.before.interest, preview.after.interest)}
                {changedRow("Penal interest owed", preview.before.penalInterest, preview.after.penalInterest)}
                {changedRow("Total owed", preview.before.total, preview.after.total)}
                <tr><td>Status</td><td className="num">{preview.before.status}</td><td className="num">{preview.after.status}</td></tr>
              </tbody>
            </table></div>
          </div>
        )}
        <FieldError msg={err} />
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal} disabled={saving}>Cancel</button>
        <button className="btn" onClick={submit} disabled={saving}>
          <Icon name="check" /> {saving ? "Working…" : preview ? "Confirm" : "Preview the change"}
        </button>
      </div>
    </>
  );
}
