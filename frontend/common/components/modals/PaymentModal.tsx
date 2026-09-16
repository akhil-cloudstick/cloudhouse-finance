"use client";

import { useEffect, useRef, Fragment, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { Icon } from "@/common/components/Icon";
import { Select } from "@/common/components/ui/Select";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/common/components/ui/SplitPaymentInput";
import { fmt } from "@/common/utils/format";
import { recordPayment, getLoan, type LoanView } from "@/modules/loans/services/loanService";
import { ApiError } from "@/common/services/httpClient";
import { useIsSmallScreen } from "@/common/utils/responsive";

/* What the Amount is allowed to pay off. Every mode clears any outstanding
 * processing fee first — a fee is a real charge, not something staff can
 * defer — and the backend rejects an amount that overshoots the buckets the
 * chosen mode is allowed to touch (see allocatePayment / ErrExceedsOutstanding).
 *
 * "Both" is the default and is what every payment used to be: the full
 * fee → penal → interest → principal waterfall. The narrower modes exist for
 * a customer settling one specific charge and leaving the rest standing.
 * Note there is no separate "interest without penal" mode — penal interest IS
 * interest, so Interest pays it first; Penal Interest is the one that stops
 * early. Adjustment/Waiver (non-cash ledger corrections) and the auction
 * types are deliberately absent: the backend refuses them on this endpoint.
 *
 * What each mode reaches, in waterfall order (no longer spelled out as a
 * hint line under the picker — the allocation preview further down shows
 * the same thing against the actual Amount, and the hint was costing this
 * modal more height than it was worth):
 *   Partial         fee → penal interest → interest → principal
 *   Interest        fee → penal interest → interest
 *   Penal Interest  fee → penal interest
 *   Principal       fee → principal
 *   Full Settlement everything owed; short of that the backend rejects it */
const ALLOCATION_MODES = [
  { value: "Partial", label: "Both — interest, then principal" },
  { value: "Interest", label: "Interest only" },
  { value: "Penal Interest", label: "Penal interest only" },
  { value: "Principal", label: "Principal only" },
  { value: "Full Settlement", label: "Full settlement — close the loan" },
];

/* previewAllocation mirrors backend/internal/loan/service.go's
 * allocatePayment for the modes this modal offers, so staff can see where the
 * Amount actually lands BEFORE recording it — "Both" in particular spreads
 * one figure across penal interest, interest and principal, which the single
 * Amount box gave no hint of. The backend remains the authority: this is a
 * display of the same waterfall, and an overshoot is still rejected there.
 *
 * `over` is what the amount could not place in any bucket the mode is allowed
 * to touch — the condition the backend turns into ErrExceedsOutstanding —
 * except for Full Settlement, which is instead SHORT when the amount doesn't
 * cover everything owed. */
function previewAllocation(loan: LoanView, mode: string, amount: number) {
  const feeOwed = loan.outstandingProcessingFee;
  const penalOwed = loan.outstandingPenalInterest;
  const interestOwed = loan.outstandingInterest;
  const principalOwed = loan.outstanding;

  if (mode === "Full Settlement") {
    const total = feeOwed + penalOwed + interestOwed + principalOwed;
    return { fee: feeOwed, penal: penalOwed, interest: interestOwed, principal: principalOwed, over: 0, short: Math.max(0, total - amount) };
  }

  // Every mode clears an outstanding fee first; the buckets after that are
  // what the mode is allowed to reach.
  let left = amount;
  const take = (owed: number, allowed: boolean) => {
    if (!allowed) return 0;
    const n = Math.min(left, Math.max(0, owed));
    left -= n;
    return n;
  };
  const fee = take(feeOwed, true);
  const penal = take(penalOwed, mode !== "Principal");
  const interest = take(interestOwed, mode === "Partial" || mode === "Interest");
  const principal = take(principalOwed, mode === "Partial" || mode === "Principal");
  return { fee, penal, interest, principal, over: Math.max(0, left), short: 0 };
}

/* Ported from legacy/app.js's `openPaymentModal()` / `savePayment()`. Posts
 * to the real POST /loans/:id/payments endpoint. Simplified from a
 * Payment-Type dropdown down to a single Amount field, then restored as the
 * "Apply Payment To" picker above (ALLOCATION_MODES) on request. The default,
 * "Both", is the backend's "Partial" waterfall allocation — processing fee →
 * penal interest → interest → principal (see
 * backend/internal/loan/service.go's allocatePayment) — so staff can leave the
 * picker alone for the ordinary case, and a payment covering everything owed
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
  const smallScreen = useIsSmallScreen();
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
  // Defaults to the full waterfall, which is what every payment did before
  // this picker existed — so leaving it alone reproduces the old behaviour.
  const [mode, setMode] = useState(ALLOCATION_MODES[0].value);
  const [fee, setFee] = useState("");
  const [date, setDate] = useState(today);
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [remaining, setRemaining] = useState(0);
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  // A fee entered here is added to the loan's owed fee BEFORE Amount is
  // allocated (see this component's doc comment), so the preview has to see
  // it too or it would under-report what the fee bucket swallows.
  const previewAmount = +amt || 0;
  const previewLoan = { ...loan, outstandingProcessingFee: loan.outstandingProcessingFee + (+fee || 0) };
  const alloc = previewAllocation(previewLoan, mode, previewAmount);
  const splitBalanced = Math.abs(remaining) < 0.01;

  async function save() {
    const amount = +amt;
    if (!amount || amount <= 0) { setErr("Please enter a valid payment amount."); return; }
    const processingFee = fee.trim() ? +fee : 0;
    if (processingFee < 0) { setErr("Processing fee cannot be negative."); return; }
    const interestOverride = interest.trim() ? +interest : undefined;
    if (interestOverride != null && interestOverride < 0) { setErr("Interest cannot be negative."); return; }
    if (!date) { setErr("Please select the payment date."); return; }
    if (!splitBalanced) { setErr("The payment breakdown must add up to the amount."); return; }
    setSaving(true);
    try {
      // The receiving employee is derived server-side from the logged-in
      // user's JWT — no employeeId sent from here (see loansApi.ts's
      // PaymentInput doc comment).
      await recordPayment(loan.numericId, {
        amount, type: mode, processingFee: processingFee || undefined, paidOn: date,
        cashAmount: split.cashAmount,
        upiAmount: split.upiAmount,
        bankTransferAmount: split.bankTransferAmount,
        chequeAmount: split.chequeAmount,
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
      {/* `bd-scroll` caps the modal at the viewport and scrolls THIS body
        * instead of the page behind it (see app.css) — this modal's own
        * `<Select>` dropdown (Apply Payment To) is a `position:absolute`
        * descendant of `.bd`, unlike DatePicker's `position:fixed` panel, so
        * it can in principle get clipped if opened right at the scrolled
        * body's bottom edge. Accepted as the smaller issue versus the whole
        * page scrolling instead of the modal — the dropdown is short (a
        * handful of allocation-mode options), so in practice this rarely
        * bites. */}
      <div className="bd bd-scroll">
        <div className="notice" style={{ marginBottom: 16, flexDirection: "column", alignItems: "stretch", gap: 4 }}>
          <div><Icon name="coin" /> Outstanding principal: <b>{fmt(loan.outstanding)}</b></div>
          <div>Outstanding interest: <b>{fmt(loan.outstandingInterest)}</b>{loan.outstandingPenalInterest > 0 && <> · Penal interest: <b>{fmt(loan.outstandingPenalInterest)}</b></>}</div>
          {loan.outstandingProcessingFee > 0 && <div>Outstanding processing fee: <b>{fmt(loan.outstandingProcessingFee)}</b></div>}
          <div>Settlement amount (pay this to close today): <b>{fmt(loan.settlementAmount)}</b></div>
        </div>
        {/* Every field sits in a 2-up grid, and the per-field helper
          * paragraphs are gone: between them and a one-field-per-row layout
          * this modal grew taller than the viewport, pushing its own footer
          * (and the Record Payment button) out of reach. The allocation
          * preview below already shows where the Amount actually lands,
          * which is what the "Apply Payment To" hint was explaining. */}
        {smallScreen ? (
          <>
            <div className="frow c2">
              <div><label className="f">Apply Payment To *</label>
                <Select options={ALLOCATION_MODES.map((m) => ({ value: m.value, label: m.label }))} value={mode} onChange={setMode} />
              </div>
              <div><label className="f">Amount (₹) *</label><input className="inp" type="number" min={1} placeholder="e.g. 5000" value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
            </div>
            <div className="frow"><div><label className="f">Payment Date *</label><input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div></div>
            <div className="frow">
              <SplitPaymentInput totalAmount={previewAmount} onChange={(s, r) => { setSplit(s); setRemaining(r); }} />
            </div>
            <div className="frow c2">
              <div><label className="f">Reference No.</label><input className="inp" placeholder="e.g. UPI txn id, cheque no." value={reference} onChange={(e) => setReference(e.target.value)} /></div>
              <div><label className="f">Interest (₹)</label>
                <input className="inp" type="number" min={0} value={interest} onChange={(e) => setInterest(e.target.value)} />
              </div>
            </div>
            <div className="frow c2">
              <div><label className="f">Additional Charges (₹)</label>
                <input className="inp" type="number" min={0} placeholder="optional — e.g. late fee, documentation charge" value={fee} onChange={(e) => setFee(e.target.value)} />
              </div>
              <div><label className="f">Description</label>
                <input className="inp" placeholder="Optional note for the ledger" value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Old (pre-Amount-sharing-a-row-with-the-picker) layout,
              * restored for big screens on request: "Apply Payment To" gets
              * its own full-width row since it's the widest-labelled field
              * here, then Amount/Date, Method/Interest, Reference/Charges
              * pair up, and Description closes it out alone. */}
            <div className="frow"><div><label className="f">Apply Payment To *</label>
              <Select options={ALLOCATION_MODES.map((m) => ({ value: m.value, label: m.label }))} value={mode} onChange={setMode} />
            </div></div>
            <div className="frow c2">
              <div><label className="f">Amount (₹) *</label><input className="inp" type="number" min={1} placeholder="e.g. 5000" value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
              <div><label className="f">Payment Date *</label><input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            </div>
            <div className="frow">
              <SplitPaymentInput totalAmount={previewAmount} onChange={(s, r) => { setSplit(s); setRemaining(r); }} />
            </div>
            <div className="frow c2">
              <div><label className="f">Interest (₹)</label>
                <input className="inp" type="number" min={0} value={interest} onChange={(e) => setInterest(e.target.value)} />
              </div>
              <div><label className="f">Reference No.</label><input className="inp" placeholder="e.g. UPI txn id, cheque no." value={reference} onChange={(e) => setReference(e.target.value)} /></div>
            </div>
            <div className="frow c2">
              <div><label className="f">Additional Charges (₹)</label>
                <input className="inp" type="number" min={0} placeholder="optional — e.g. late fee, documentation charge" value={fee} onChange={(e) => setFee(e.target.value)} />
              </div>
              <div><label className="f">Description</label>
                <input className="inp" placeholder="Optional note for the ledger" value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
            </div>
          </>
        )}
        {previewAmount > 0 && (
          <div className="notice" style={{ marginBottom: 4, flexDirection: "column", alignItems: "stretch", gap: 4 }}>
            <div><Icon name="coin" /> This {fmt(previewAmount)} will be applied as:</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "2px 16px", fontSize: 13 }}>
              {([
                ["Processing fee", alloc.fee],
                ["Penal interest", alloc.penal],
                ["Interest", alloc.interest],
                ["Principal", alloc.principal],
              ] as const).map(([label, value]) => (
                <Fragment key={label}>
                  <span style={{ color: value > 0 ? undefined : "var(--muted)" }}>{label}</span>
                  <b style={{ textAlign: "right", color: value > 0 ? undefined : "var(--muted)" }}>{fmt(value)}</b>
                </Fragment>
              ))}
            </div>
            {alloc.over > 0.01 && (
              <div style={{ color: "var(--red)" }}>
                {fmt(alloc.over)} more than this mode can apply — the payment will be rejected. Reduce the amount or pick a wider mode.
              </div>
            )}
            {alloc.short > 0.01 && (
              <div style={{ color: "var(--red)" }}>
                {fmt(alloc.short)} short of everything owed — a full settlement must cover the whole balance.
              </div>
            )}
          </div>
        )}
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving || !splitBalanced}><Icon name="check" /> {saving ? "Recording…" : "Record Payment"}</button>
      </div>
    </>
  );
}
