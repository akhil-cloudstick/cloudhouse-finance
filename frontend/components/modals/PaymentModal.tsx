"use client";

import { useState } from "react";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { fmt } from "@/lib/format";
import { recordPayment, type LoanView } from "@/lib/loansApi";
import { ApiError } from "@/lib/api";

const METHODS = ["Cash", "UPI", "Bank Transfer", "Cheque"];

/* Ported from legacy/app.js's `openPaymentModal()` / `savePayment()`. Now
 * posts to the real POST /loans/:id/payments endpoint instead of the mock
 * db's local ledger. Amounts are allocated server-side against penal
 * interest → interest → principal per the selected type (see
 * backend/internal/loan/service.go's allocatePayment) — Adjustment/Waiver
 * don't involve cash and are flagged as such below since they don't touch
 * Cash-in-Hand. */
export function PaymentModalContent({ loan, onSaved }: { loan: LoanView; onSaved: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [type, setType] = useState("");
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState(METHODS[0]);
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const isNonCash = type === "Adjustment" || type === "Waiver";

  async function save() {
    if (!type) { setErr("Please select a payment type."); return; }
    const amount = +amt;
    if (!amount || amount <= 0) { setErr("Please enter a valid payment amount."); return; }
    if (!date) { setErr("Please select the payment date."); return; }
    setSaving(true);
    try {
      // No auth/session exists yet — see LoanDetail.tsx's note on employeeId 1.
      await recordPayment(loan.numericId, {
        amount, type, paidOn: date, employeeId: 1,
        method: isNonCash ? undefined : method,
        reference: reference.trim() || undefined,
        description: description.trim() || undefined,
      });
      onSaved();
      closeModal();
      toast(`${isNonCash ? "Recorded" : "Payment of " + fmt(amount)} (${type})`);
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
        <div className="notice" style={{ marginBottom: 16, flexDirection: "column", alignItems: "stretch", gap: 4 }}>
          <div><Icon name="coin" /> Outstanding principal: <b>{fmt(loan.outstanding)}</b></div>
          <div>Outstanding interest: <b>{fmt(loan.outstandingInterest)}</b>{loan.outstandingPenalInterest > 0 && <> · Penal interest: <b>{fmt(loan.outstandingPenalInterest)}</b></>}</div>
          <div>Settlement amount (pay this to close today): <b>{fmt(loan.settlementAmount)}</b></div>
        </div>
        <div className="frow"><div><label className="f">Payment Type *</label>
          <select className="inp" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Select payment type…</option>
            <option>Interest</option>
            <option>Principal</option>
            <option>Partial</option>
            <option>Full Settlement</option>
            <option>Adjustment</option>
            <option>Waiver</option>
          </select></div></div>
        {isNonCash && (
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: -6, marginBottom: 10 }}>
            {type === "Adjustment" ? "Corrects the outstanding principal directly — no cash is received." : "Forgives outstanding interest/penal interest — no cash is received."}
          </p>
        )}
        <div className="frow c2">
          <div><label className="f">Amount (₹) *</label><input className="inp" type="number" min={1} placeholder="e.g. 5000" value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
          <div><label className="f">{isNonCash ? "Date *" : "Payment Date *"}</label><input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        {!isNonCash && (
          <div className="frow c2">
            <div><label className="f">Payment Method</label>
              <select className="inp" value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map((m) => <option key={m}>{m}</option>)}
              </select></div>
            <div><label className="f">Reference No.</label><input className="inp" placeholder="e.g. UPI txn id, cheque no." value={reference} onChange={(e) => setReference(e.target.value)} /></div>
          </div>
        )}
        <div className="frow"><div><label className="f">Description</label>
          <input className="inp" placeholder="Optional note for the ledger" value={description} onChange={(e) => setDescription(e.target.value)} /></div></div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Recording…" : "Record Payment"}</button>
      </div>
    </>
  );
}
