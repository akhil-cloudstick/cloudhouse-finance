"use client";

import { useState } from "react";
import { recordPayment, PAYMENT_MODE_LABELS, SuperAdminApiError } from "@/modules/superadmin/services/superadminService";
import { type Business, type PaymentMode } from "@/modules/superadmin/types/superadmin-types";
import { Select } from "@/modules/superadmin/components/Select";

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
type RecordPaymentModalProps = {
  business: Business;
  onClose: () => void;
  onDone: () => void;
};

export function RecordPaymentModal({
  business,
  onClose,
  onDone,
}: RecordPaymentModalProps) {
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(todayISO());
  const [mode, setMode] = useState<PaymentMode>("bank_transfer");
  const [reference, setReference] = useState("");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const rupees = Number(amount);
    if (!Number.isFinite(rupees) || rupees <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (!paidOn) {
      setError("Enter the date the payment was made.");
      return;
    }
    setSubmitting(true);
    try {
      await recordPayment(business.id, {
        amountInPaise: Math.round(rupees * 100),
        paidOn,
        mode,
        reference,
        note,
        periodFrom: periodFrom || undefined,
        periodTo: periodTo || undefined,
      });
      onDone();
    } catch (err) {
      setError(err instanceof SuperAdminApiError ? err.message : "Could not record the payment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sa-modal-backdrop" onClick={onClose}>
      <form className="sa-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="sa-modal-head">
          <h2>Record payment — {business.name}</h2>
        </div>
        <div className="sa-modal-body">
          <p className="sa-modal-note">
            For your records only. Nothing is charged, and the plan, status and renewal date stay as they are.
          </p>
          <div className="sa-grid-2">
            <div className="sa-field">
              <label>Amount (₹)</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
            </div>
            <div className="sa-field">
              <label>Paid on</label>
              <input type="date" value={paidOn} max={todayISO()} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
            <div className="sa-field">
              <label>Mode</label>
              <Select
                value={mode}
                onChange={(v) => setMode(v as PaymentMode)}
                ariaLabel="Payment mode"
                options={(Object.keys(PAYMENT_MODE_LABELS) as PaymentMode[]).map((m) => ({
                  value: m,
                  label: PAYMENT_MODE_LABELS[m],
                }))}
              />
            </div>
            <div className="sa-field">
              <label>Reference (optional)</label>
              <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." />
            </div>
            <div className="sa-field">
              <label>Period from (optional)</label>
              <input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
            </div>
            <div className="sa-field">
              <label>Period to (optional)</label>
              <input
                type="date"
                value={periodTo}
                min={periodFrom || undefined}
                onChange={(e) => setPeriodTo(e.target.value)}
              />
            </div>
          </div>
          <div className="sa-field">
            <label>Note (optional)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
          {error && <p className="sa-error">{error}</p>}
        </div>
        <div className="sa-modal-foot">
          <span className="sa-foot-spacer" />
          <button type="button" className="sa-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="sa-btn primary" disabled={submitting}>
            {submitting ? "Saving…" : "Record payment"}
          </button>
        </div>
      </form>
    </div>
  );
}
