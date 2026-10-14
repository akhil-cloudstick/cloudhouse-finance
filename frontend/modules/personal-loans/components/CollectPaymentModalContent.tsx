"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { ApiError } from "@/common/services/httpClient";
import { fmt } from "@/common/utils/format";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";
import { recordPersonalLoanPayment } from "@/modules/personal-loans/services/personalLoanService";
import { type BackendPersonalLoan } from "@/modules/personal-loans/types/personal-loan-types";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/common/components/SplitPaymentInput";

// Server messages are put on the field they are about, by wording.
const SERVER_FIELDS: Record<string, RegExp> = {
  split: /breakdown|bank|cash|upi|cheque/i,
  amount: /amount/i,
};

type CollectPaymentModalContentProps = { loan: BackendPersonalLoan; onSaved: () => void };

export function CollectPaymentModalContent({ loan, onSaved }: CollectPaymentModalContentProps) {
  const { closeModal } = useModal();
  const toast = useToast();

  // Defaults to the loan's standard installment amount (capped at whatever
  // is actually still owed, for a loan nearing its final, smaller
  // installment) — the common case is collecting exactly one installment,
  // so the field starts pre-filled with that rather than empty; staff can
  // still edit it for a partial/extra payment.
  const defaultAmount = Math.min(loan.installmentAmount, loan.outstandingAmount);
  const [amount, setAmount] = useState(defaultAmount > 0 ? String(defaultAmount) : "");
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [remaining, setRemaining] = useState(0);
  const [bankId, setBankId] = useState<number | undefined>(undefined);
  const [err, setErr] = useState("");
  const [fe, setFe] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const amt = +amount || 0;
  const balanced = Math.abs(remaining) < 0.01;

  const fail = (field: string, msg: string) => { setErr(""); setFe({ [field]: msg }); };
  const clearFe = (field: string) => setFe((cur) => (cur[field] ? { ...cur, [field]: "" } : cur));

  async function save() {
    if (!amt || amt <= 0) { fail("amount", "Please enter the amount collected."); return; }
    if (amt > loan.outstandingAmount + 0.01) { fail("amount", `Amount cannot exceed the outstanding balance of ${fmt(loan.outstandingAmount)}.`); return; }
    if (!balanced) { fail("split", "The payment breakdown must add up to the amount collected."); return; }
    setSaving(true);
    setErr("");
    setFe({});
    try {
      await recordPersonalLoanPayment(loan.id, {
        amount: amt,
        cashAmount: split.cashAmount,
        upiAmount: split.upiAmount,
        bankTransferAmount: split.bankTransferAmount,
        chequeAmount: split.chequeAmount,
        bankId,
      });
      toast(`Payment of ${fmt(amt)} recorded against ${loan.loanNumber}`);
      onSaved();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not record the payment — try again.";
      const field = e instanceof ApiError ? fieldForMessage(msg, SERVER_FIELDS) : "";
      if (field) fail(field, msg); else setErr(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Collect Payment — {loan.loanNumber}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="notice" style={{ marginBottom: 16 }}>Outstanding balance: <strong>{fmt(loan.outstandingAmount)}</strong></div>
        <div className="frow">
          <div className={fe.amount ? "has-err" : undefined}><label className="f">Amount (₹) *</label><input className="inp" type="number" min={1} max={loan.outstandingAmount} placeholder={`e.g. ${defaultAmount}`} value={amount} onChange={(e) => { setAmount(e.target.value); clearFe("amount"); }} /><FieldError msg={fe.amount} /></div>
        </div>
        <div className="frow" style={{ marginTop: 4 }}>
          <div className={fe.split ? "has-err" : undefined} style={{ width: "100%", minWidth: 0 }}>
            <SplitPaymentInput totalAmount={amt} onChange={(s, r, b) => { setSplit(s); setRemaining(r); setBankId(b); }} />
            <FieldError msg={fe.split} />
          </div>
        </div>
        {err && <div className="notice" style={{ marginTop: 10 }}>{err}</div>}
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" disabled={saving || !balanced} onClick={save}>{saving ? "Collecting…" : "Collect"}</button>
      </div>
    </>
  );
}
