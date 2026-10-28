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
import { editLoanTopUp, deleteLoanTopUp, type LedgerEditPreview } from "@/modules/loans/services/loanService";
import { type LoanTopUpView } from "@/modules/loans/types/loan-types";

type Props = {
  loanId: number;
  topUp: LoanTopUpView;
  mode: "edit" | "delete";
  minDate?: string; // the loan's start — a top-up cannot be dated before it
  onSaved: () => void;
};

// Two steps, like a payment edit: the first click previews what the change does to the loan (nothing is saved),
// the second click saves it. The loan is recalculated from its first day with every top-up on its date.
export function TopUpEditModalContent({ loanId, topUp: t, mode, minDate, onSaved }: Props) {
  const { closeModal } = useModal();
  const toast = useToast();
  const [date, setDate] = useState(t.occurredOn.slice(0, 10));
  const [amount, setAmount] = useState(String(t.amount));
  const [reference, setReference] = useState(t.reference || "");
  const initialLines: SplitPaymentLine[] = [
    t.cashAmount > 0 && { mode: "Cash" as const, amount: String(t.cashAmount) },
    t.upiAmount > 0 && { mode: "UPI" as const, amount: String(t.upiAmount), bankId: t.bankId ?? undefined },
    t.bankTransferAmount > 0 && { mode: "Bank Transfer" as const, amount: String(t.bankTransferAmount), bankId: t.bankId ?? undefined },
  ].filter(Boolean) as SplitPaymentLine[];
  const [split, setSplit] = useState<SplitAmounts>({ cashAmount: t.cashAmount, upiAmount: t.upiAmount, bankTransferAmount: t.bankTransferAmount, chequeAmount: 0 });
  const [remaining, setRemaining] = useState(0);
  const [bankId, setBankId] = useState<number | undefined>(t.bankId ?? undefined);
  const [preview, setPreview] = useState<LedgerEditPreview | null>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  function changed(set: (v: string) => void) {
    return (v: string) => { setPreview(null); setErr(""); set(v); };
  }

  async function submit() {
    return singleFlight("modal:topup-edit", async () => {
      const dry = preview == null;
      setSaving(true);
      try {
        let res: LedgerEditPreview;
        if (mode === "delete") {
          res = await deleteLoanTopUp(loanId, t.id, dry);
        } else {
          const amt = +amount;
          if (!(amt > 0)) { setErr("Enter a valid amount."); return; }
          if (Math.abs(remaining) > 0.01) { setErr(`The payment breakdown must add up to the amount (${fmt(amt)}).`); return; }
          if ((split.upiAmount > 0 || split.bankTransferAmount > 0) && !bankId) { setErr("Select the bank for the UPI / Bank Transfer part."); return; }
          res = await editLoanTopUp(loanId, t.id, {
            occurredOn: date, amount: amt, reference,
            cashAmount: split.cashAmount, upiAmount: split.upiAmount, bankTransferAmount: split.bankTransferAmount, bankId,
          }, dry);
        }
        if (dry) { setPreview(res); setErr(""); return; }
        toast(mode === "delete" ? "Top-up deleted and the loan recalculated" : "Top-up updated and the loan recalculated");
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
      <div className="hd"><h3>{mode === "delete" ? "Delete" : "Edit"} Top-Up</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll ledger-edit-bd">
        <p className="notice" style={{ marginBottom: 12 }}>
          The loan is recalculated from its first day, so its principal, interest, later payments, balances and the cash
          ledger update to match this change.
        </p>
        {mode === "edit" ? (
          <>
            <div className="frow c2">
              <div><label className="f">Date *</label><DatePicker value={date} min={minDate} max={today} onChange={changed(setDate)} /></div>
              <div><label className="f">Top-up Amount (₹) *</label><input className="inp" type="number" min={0} value={amount} onChange={(e) => changed(setAmount)(e.target.value)} /></div>
            </div>
            <div className="frow">
              <div><label className="f">Reference</label><input className="inp" value={reference} onChange={(e) => changed(setReference)(e.target.value)} /></div>
            </div>
            <h4 style={{ margin: "14px 0 6px", fontSize: 13 }}>Payout breakdown <small style={{ fontWeight: 400, color: "var(--muted)" }}>How the money went out</small></h4>
            <SplitPaymentInput
              totalAmount={+amount || 0} initialLines={initialLines} scrollInternally={false} label={null}
              onChange={(s, r, b) => { setPreview(null); setErr(""); setSplit(s); setRemaining(r); setBankId(b); }}
            />
          </>
        ) : (
          <p style={{ marginBottom: 12 }}>
            Delete the top-up of <b>{fmt(t.amount)}</b> dated <b>{t.occurredOn.slice(0, 10)}</b>? Its cash-ledger lines are removed, the loan&apos;s
            principal goes back down by that amount, and any interest settled from its payout is removed too.
          </p>
        )}
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
          <Icon name={mode === "delete" ? "trash" : "check"} /> {saving ? "Working…" : preview ? (mode === "delete" ? "Confirm delete" : "Confirm") : "Preview the change"}
        </button>
      </div>
    </>
  );
}
