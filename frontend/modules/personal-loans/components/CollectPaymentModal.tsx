"use client";

import { useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { ApiError } from "@/common/services/httpClient";
import { fmt } from "@/common/utils/format";
import { recordPersonalLoanPayment, type BackendPersonalLoan } from "@/modules/personal-loans/services/personalLoanService";
import { Select } from "@/common/components/ui/Select";

const METHOD_OPTIONS = [
  { value: "Cash", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "Bank Transfer", label: "Bank Transfer" },
];

export function CollectPaymentModalContent({ loan, onSaved }: { loan: BackendPersonalLoan; onSaved: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();

  // Defaults to the loan's standard installment amount (capped at whatever
  // is actually still owed, for a loan nearing its final, smaller
  // installment) — the common case is collecting exactly one installment,
  // so the field starts pre-filled with that rather than empty; staff can
  // still edit it for a partial/extra payment.
  const defaultAmount = Math.min(loan.installmentAmount, loan.outstandingAmount);
  const [amount, setAmount] = useState(defaultAmount > 0 ? String(defaultAmount) : "");
  const [method, setMethod] = useState("Cash");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const amt = +amount || 0;
    if (!amt || amt <= 0) { setErr("Please enter the amount collected."); return; }
    if (amt > loan.outstandingAmount + 0.01) { setErr(`Amount cannot exceed the outstanding balance of ${fmt(loan.outstandingAmount)}.`); return; }
    setSaving(true);
    setErr("");
    try {
      await recordPersonalLoanPayment(loan.id, { amount: amt, method, reference: reference.trim() || undefined, description: description.trim() || undefined });
      toast(`Payment of ${fmt(amt)} recorded against ${loan.loanNumber}`);
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not record the payment — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Collect Payment — {loan.loanNumber}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="notice" style={{ marginBottom: 16 }}>Outstanding balance: <strong>{fmt(loan.outstandingAmount)}</strong></div>
        <div className="frow c2">
          <div><label className="f">Amount (₹) *</label><input className="inp" type="number" min={1} max={loan.outstandingAmount} placeholder={`e.g. ${defaultAmount}`} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div><label className="f">Method</label>
            <Select options={METHOD_OPTIONS} value={method} onChange={setMethod} />
          </div>
        </div>
        <div className="frow c2">
          <div><label className="f">Reference</label><input className="inp" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} /></div>
          <div><label className="f">Note</label><input className="inp" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={255} /></div>
        </div>
        {err && <div className="notice" style={{ marginTop: 10 }}>{err}</div>}
      </div>
      <div className="ft">
        <button className="btn plain" style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase" }} onClick={closeModal}>Cancel</button>
        <button className="btn" disabled={saving} onClick={save}>{saving ? "Collecting…" : "Collect"}</button>
      </div>
    </>
  );
}
