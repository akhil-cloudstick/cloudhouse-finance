"use client";

import { useState } from "react";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { fmt } from "@/lib/format";
import { recordPayment, type LoanView } from "@/lib/loansApi";
import { ApiError } from "@/lib/api";

/* Ported from legacy/app.js's `openPaymentModal()` / `savePayment()`. Now
 * posts to the real POST /loans/:id/payments endpoint instead of the mock
 * db's local ledger. */
export function PaymentModalContent({ loan, onSaved }: { loan: LoanView; onSaved: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [type, setType] = useState("");
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(today);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!type) { setErr("Please select a payment type."); return; }
    const amount = +amt;
    if (!amount || amount <= 0) { setErr("Please enter a valid payment amount."); return; }
    if (!date) { setErr("Please select the payment date."); return; }
    setSaving(true);
    try {
      // No auth/session exists yet — see LoanDetail.tsx's note on employeeId 1.
      await recordPayment(loan.numericId, { amount, type, paidOn: date, employeeId: 1 });
      onSaved();
      closeModal();
      toast(`Payment of ${fmt(amount)} recorded (${type})`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not record the payment — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Record Payment — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="notice" style={{ marginBottom: 16 }}>
          <Icon name="coin" /> Current outstanding: <b>{loan.outstanding ? fmt(loan.outstanding) : "—"}</b>
        </div>
        <div className="frow"><div><label className="f">Payment Type *</label>
          <select className="inp" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Select payment type…</option>
            <option>Interest</option>
            <option>Principal</option>
            <option>Partial</option>
            <option>Full Settlement</option>
          </select></div></div>
        <div className="frow c2">
          <div><label className="f">Amount (₹) *</label><input className="inp" type="number" min={1} placeholder="e.g. 5000" value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
          <div><label className="f">Payment Date *</label><input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Recording…" : "Record Payment"}</button>
      </div>
    </>
  );
}
