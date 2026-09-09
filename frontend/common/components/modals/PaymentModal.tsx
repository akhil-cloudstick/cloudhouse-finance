"use client";

import { useEffect, useRef, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { Icon } from "@/common/components/Icon";
import { Select } from "@/common/components/ui/Select";
import { fmt } from "@/common/utils/format";
import { recordPayment, getLoan, type LoanView } from "@/modules/loans/services/loanService";
import { ApiError } from "@/common/services/httpClient";

const METHODS = ["Cash", "UPI", "Bank Transfer", "Cheque"];

/* Ported from legacy/app.js's `openPaymentModal()` / `savePayment()`. Posts
 * to the real POST /loans/:id/payments endpoint. Simplified from a
 * Payment-Type dropdown (Interest/Principal/Partial/Full Settlement/
 * Adjustment/Waiver) down to a single Amount field: every payment now goes
 * through the backend's "Partial" waterfall allocation — processing fee →
 * penal interest → interest → principal (see
 * backend/internal/loan/service.go's allocatePayment) — so staff never
 * have to pick a bucket by hand, and a payment covering everything owed
 * (including any outstanding fee) auto-closes the loan (same generic
 * close-on-zero-outstanding check the backend already runs regardless of
 * payment type). Adjustment/Waiver (non-cash ledger corrections) are no
 * longer reachable from this modal — an explicit scope decision, not an
 * oversight; a different entry point would need to be built if they're
 * still needed.
 *
 * Also collects an optional processing fee / additional charge — entering
 * one adds it to the loan's total owed (Loan.OutstandingProcessingFee)
 * *before* Amount is allocated, so this same payment's Amount pays the fee
 * off first, ahead of penal interest/interest/principal (see
 * LoanPayment.ProcessingFee/ProcessingFeeApplied). It's not extra cash on
 * top of Amount — Amount is the total cash handed over either way. */
export function PaymentModalContent({ loan: initialLoan, onSaved }: { loan: LoanView; onSaved: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  // The caller's `loan` prop can be a few minutes (or a full accrual cycle)
  // stale by the time staff actually open this modal — LoanDetail.tsx only
  // re-fetches on an explicit action, not on every render. Re-fetching here
  // on mount guarantees the outstanding-interest figure shown (both the
  // notice line above and the Interest field's prefill below) reflects
  // whatever has accrued up to THIS moment, not whatever it was when the
  // page last loaded.
  const [loan, setLoan] = useState(initialLoan);
  useEffect(() => {
    let cancelled = false;
    getLoan(initialLoan.numericId).then((fresh) => {
      if (cancelled) return;
      setLoan(fresh);
      // Only overwrite the prefill if the user hasn't already touched it —
      // an in-flight refresh landing after they've started typing their
      // own override would otherwise clobber it mid-edit.
      if (!interestTouchedRef.current) setInterestRaw(fresh.outstandingInterest > 0 ? String(fresh.outstandingInterest) : "");
    }).catch(() => { /* keep the possibly-stale prop rather than blocking the form */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLoan.numericId]);

  const [amt, setAmt] = useState("");
  // Prefilled with the live-calculated figure but editable — the formula
  // (see backend accrual.go's projectAccrual: minimum one month, then
  // whole months + a daily-prorated remainder) is a formula, not a court
  // order, and staff need to be able to charge a different actual amount
  // for a specific settlement. Cleared by hand means "use whatever the
  // system calculates".
  const [interest, setInterestRaw] = useState(initialLoan.outstandingInterest > 0 ? String(initialLoan.outstandingInterest) : "");
  const interestTouchedRef = useRef(false);
  function setInterest(v: string) {
    interestTouchedRef.current = true;
    setInterestRaw(v);
  }
  const [fee, setFee] = useState("");
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState(METHODS[0]);
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const amount = +amt;
    if (!amount || amount <= 0) { setErr("Please enter a valid payment amount."); return; }
    const processingFee = fee.trim() ? +fee : 0;
    if (processingFee < 0) { setErr("Processing fee cannot be negative."); return; }
    const interestOverride = interest.trim() ? +interest : undefined;
    if (interestOverride != null && interestOverride < 0) { setErr("Interest cannot be negative."); return; }
    if (!date) { setErr("Please select the payment date."); return; }
    setSaving(true);
    try {
      // The receiving employee is derived server-side from the logged-in
      // user's JWT — no employeeId sent from here (see loansApi.ts's
      // PaymentInput doc comment). Always "Partial" — see this file's doc
      // comment on why the type picker was removed.
      await recordPayment(loan.numericId, {
        amount, type: "Partial", processingFee: processingFee || undefined, paidOn: date,
        method,
        reference: reference.trim() || undefined,
        description: description.trim() || undefined,
        interestOverride,
      });
      onSaved();
      closeModal();
      toast(`Payment of ${fmt(amount)} recorded${processingFee ? ` (incl. ${fmt(processingFee)} processing fee charged)` : ""}`);
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
          {loan.outstandingProcessingFee > 0 && <div>Outstanding processing fee: <b>{fmt(loan.outstandingProcessingFee)}</b></div>}
          <div>Settlement amount (pay this to close today): <b>{fmt(loan.settlementAmount)}</b></div>
        </div>
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: -6, marginBottom: 10 }}>
          The amount is applied automatically — any outstanding processing fee first, then penal
          interest, then interest, then principal. Paying the full settlement amount closes the loan.
        </p>
        <div className="frow c2">
          <div><label className="f">Amount (₹) *</label><input className="inp" type="number" min={1} placeholder="e.g. 5000" value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
          <div><label className="f">Payment Date *</label><input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">Payment Method</label>
            <Select options={METHODS.map((m) => ({ value: m, label: m }))} value={method} onChange={setMethod} />
          </div>
          <div><label className="f">Reference No.</label><input className="inp" placeholder="e.g. UPI txn id, cheque no." value={reference} onChange={(e) => setReference(e.target.value)} /></div>
        </div>
        <div className="frow"><div><label className="f">Interest (₹)</label>
          <input className="inp" type="number" min={0} value={interest} onChange={(e) => setInterest(e.target.value)} />
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>
            Prefilled with the calculated outstanding interest — editable, or clear it to use the calculated
            figure.
          </p>
        </div></div>
        <div className="frow"><div><label className="f">Processing Fee / Additional Charges (₹)</label>
          <input className="inp" type="number" min={0} placeholder="optional — e.g. late fee, documentation charge" value={fee} onChange={(e) => setFee(e.target.value)} />
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>
            Added to the total owed, then deducted first from the Amount above — before interest or
            principal. Not extra cash on top of Amount.
          </p>
        </div></div>
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
