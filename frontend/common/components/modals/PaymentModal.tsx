"use client";

import { useEffect, useRef, Fragment, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { Icon } from "@/common/components/Icon";
import { Select } from "@/common/components/ui/Select";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/common/components/ui/SplitPaymentInput";
import { fmt } from "@/common/utils/format";
import { recordPayment, recordReleasePayment, getLoan, type LoanView } from "@/modules/loans/services/loanService";
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
// releaseRequestId, when passed, routes this same form at the release
// endpoint (POST /loans/requests/:requestId/release-payment) instead of the
// plain loan payment endpoint, and reveals a Discount field only relevant
// in that context (negotiated reduction, no-cash entry) — see the release
// review screen's own "Record Payment"/"Top-Up Payment" actions
// (ReleaseReviewModal.tsx). Everything else (allocation mode, split
// payment, interest override, processing fee) is identical either way, so
// this stays one component rather than a duplicate bespoke modal.
export function PaymentModalContent({ loan: initialLoan, onSaved, releaseRequestId }: { loan: LoanView; onSaved: () => void; releaseRequestId?: number }) {
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
      if (!amountTouchedRef.current) {
        const v = amountForMode(fresh, mode);
        setAmt(v > 0 ? String(v) : "");
      }
    }).catch(() => { /* keep the possibly-stale prop rather than blocking the form */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLoan.numericId]);

  // amountForMode is what's actually owed in the bucket(s) the picked mode
  // reaches — same buckets previewAllocation below draws from — so staff
  // rarely have to type Amount by hand at all; picking a mode just fills in
  // what it would fully clear. Full Settlement/Partial ("Both") both reach
  // everything owed, since Partial's waterfall is the same fee→penal→
  // interest→principal chain a settlement pays in full.
  function amountForMode(l: LoanView, m: string): number {
    switch (m) {
      case "Interest":
        return l.outstandingProcessingFee + l.outstandingPenalInterest + l.outstandingInterest;
      case "Penal Interest":
        return l.outstandingProcessingFee + l.outstandingPenalInterest;
      case "Principal":
        return l.outstandingProcessingFee + l.outstanding;
      case "Partial":
      case "Full Settlement":
      default:
        return l.settlementAmount;
    }
  }

  const [amt, setAmt] = useState(() => {
    const v = amountForMode(initialLoan, ALLOCATION_MODES[0].value);
    return v > 0 ? String(v) : "";
  });
  // Set the instant a mode is picked, before the user has typed their own
  // Amount — once they touch the field by hand this stops overwriting it, same
  // "prefill, don't fight an edit" rule as the Interest field's own
  // interestTouchedRef below.
  const amountTouchedRef = useRef(false);
  function selectMode(nextMode: string) {
    setMode(nextMode);
    if (!amountTouchedRef.current) {
      const v = amountForMode(loan, nextMode);
      setAmt(v > 0 ? String(v) : "");
    }
  }
  function setAmount(v: string) {
    amountTouchedRef.current = true;
    setAmt(v);
  }
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
  const [bankId, setBankId] = useState<number | undefined>(undefined);
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  // Release-context only (releaseRequestId set) — a negotiated reduction
  // with no cash movement, posted alongside the payment as a real
  // PaymentTypeDiscount ledger entry (see backend/internal/loan/service.go's
  // RecordReleaseRequestPayment).
  const [discount, setDiscount] = useState("");
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
    const discountAmount = discount.trim() ? +discount : 0;
    if (discountAmount < 0) { setErr("Discount cannot be negative."); return; }
    if (discountAmount > amount) { setErr("Discount cannot exceed the amount."); return; }
    setSaving(true);
    try {
      // The receiving employee is derived server-side from the logged-in
      // user's JWT — no employeeId sent from here (see loansApi.ts's
      // PaymentInput doc comment).
      if (releaseRequestId != null) {
        // Amount here is what's typed as the full settlement figure — the
        // discount is a negotiated reduction covering part of it with no
        // cash movement, so the actual cash payment sent alongside it is
        // the remainder. RecordReleaseRequestPayment applies the discount
        // as its own ledger entry FIRST, which reduces the loan's
        // outstanding balance before the payment call runs — sending the
        // undiscounted amount here would then overshoot what's left owed
        // and get rejected as ErrExceedsOutstanding, even though the
        // discount had already gone through (see that function's own
        // sequencing). Netting it out here keeps the two in sync.
        const cashAmount = Math.round((amount - discountAmount) * 100) / 100;
        // interestOverride is prefilled from outstandingInterest at MODAL-
        // OPEN time (see the `interest` state's own doc comment) — a fixed
        // snapshot, not live. The discount posted just above (inside
        // RecordReleaseRequestPayment) reduces outstanding interest FIRST
        // in its own penal->interest->principal waterfall before this
        // payment call ever runs, so that stale prefilled figure no longer
        // matches what's actually still owed once a discount is in play —
        // sending it anyway made Full Settlement's amount-vs-total check
        // compare against the wrong total and reject a correct payment.
        // Only suppressed when the user hasn't hand-edited the field
        // (interestTouchedRef): an explicit override is still respected,
        // same as with no discount at all.
        const effectiveInterestOverride = discountAmount > 0 && !interestTouchedRef.current ? undefined : interestOverride;
        // The split breakdown (cash/UPI/bank transfer/cheque) was entered
        // against the full pre-discount Amount, so it no longer sums to
        // cashAmount once the discount is netted out above — scaled down
        // by the same ratio so it still adds up to what's actually being
        // sent (ValidateSplit on the backend requires the parts to sum to
        // the whole). Discount-only settlements (nothing left to pay in
        // cash) skip the split entirely.
        const splitRatio = amount > 0 ? cashAmount / amount : 0;
        const scaledSplit = cashAmount <= 0.01 ? ZERO_SPLIT : {
          cashAmount: Math.round(split.cashAmount * splitRatio * 100) / 100,
          upiAmount: Math.round(split.upiAmount * splitRatio * 100) / 100,
          bankTransferAmount: Math.round(split.bankTransferAmount * splitRatio * 100) / 100,
          chequeAmount: Math.round(split.chequeAmount * splitRatio * 100) / 100,
        };
        // Rounding across four components can leave a fraction of a rupee
        // unaccounted for — folded into cash (the default/most common mode)
        // rather than left as drift the backend's own sum check would reject.
        const scaledTotal = scaledSplit.cashAmount + scaledSplit.upiAmount + scaledSplit.bankTransferAmount + scaledSplit.chequeAmount;
        scaledSplit.cashAmount = Math.round((scaledSplit.cashAmount + (cashAmount - scaledTotal)) * 100) / 100;
        await recordReleasePayment(releaseRequestId, {
          amount: cashAmount, type: mode, discount: discountAmount || undefined,
          cashAmount: scaledSplit.cashAmount,
          upiAmount: scaledSplit.upiAmount,
          bankTransferAmount: scaledSplit.bankTransferAmount,
          chequeAmount: scaledSplit.chequeAmount,
          bankId,
          reference: reference.trim() || undefined,
          interestOverride: effectiveInterestOverride,
        });
      } else {
        await recordPayment(loan.numericId, {
          amount, type: mode, processingFee: processingFee || undefined, paidOn: date,
          cashAmount: split.cashAmount,
          upiAmount: split.upiAmount,
          bankTransferAmount: split.bankTransferAmount,
          chequeAmount: split.chequeAmount,
          bankId,
          reference: reference.trim() || undefined,
          description: description.trim() || undefined,
          interestOverride,
        });
      }
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
                <Select options={ALLOCATION_MODES.map((m) => ({ value: m.value, label: m.label }))} value={mode} onChange={selectMode} />
              </div>
              <div><label className="f">Amount (₹) *</label><input className="inp" type="number" min={1} placeholder="e.g. 5000" value={amt} onChange={(e) => setAmount(e.target.value)} /></div>
            </div>
            <div className="frow"><div><label className="f">Payment Date *</label><input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div></div>
            <div className="frow">
              <SplitPaymentInput totalAmount={previewAmount} onChange={(s, r, b) => { setSplit(s); setRemaining(r); setBankId(b); }} scrollInternally={false} />
            </div>
            <div className="frow c2">
              <div><label className="f">Reference No.</label><input className="inp" placeholder="e.g. UPI txn id, cheque no." value={reference} onChange={(e) => setReference(e.target.value)} /></div>
              <div><label className="f">Interest (₹)</label>
                <input className="inp" type="number" min={0} value={interest} onChange={(e) => setInterest(e.target.value)} />
              </div>
            </div>
            <div className="frow c2">
              {releaseRequestId != null ? (
                <div><label className="f">Discount (₹)</label><input className="inp" type="number" min={0} placeholder="optional — negotiated reduction" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
              ) : (
                <div><label className="f">Additional Charges (₹)</label>
                  <input className="inp" type="number" min={0} placeholder="optional — e.g. late fee, documentation charge" value={fee} onChange={(e) => setFee(e.target.value)} />
                </div>
              )}
              <div><label className="f">Description</label>
                <input className="inp" placeholder="Optional note for the ledger" value={description} onChange={(e) => setDescription(e.target.value)} disabled={releaseRequestId != null} />
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
              <Select options={ALLOCATION_MODES.map((m) => ({ value: m.value, label: m.label }))} value={mode} onChange={selectMode} />
            </div></div>
            <div className="frow c2">
              <div><label className="f">Amount (₹) *</label><input className="inp" type="number" min={1} placeholder="e.g. 5000" value={amt} onChange={(e) => setAmount(e.target.value)} /></div>
              <div><label className="f">Payment Date *</label><input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            </div>
            <div className="frow">
              <SplitPaymentInput totalAmount={previewAmount} onChange={(s, r, b) => { setSplit(s); setRemaining(r); setBankId(b); }} scrollInternally={false} />
            </div>
            <div className="frow c2">
              <div><label className="f">Interest (₹)</label>
                <input className="inp" type="number" min={0} value={interest} onChange={(e) => setInterest(e.target.value)} />
              </div>
              <div><label className="f">Reference No.</label><input className="inp" placeholder="e.g. UPI txn id, cheque no." value={reference} onChange={(e) => setReference(e.target.value)} /></div>
            </div>
            <div className="frow c2">
              {releaseRequestId != null ? (
                <div><label className="f">Discount (₹)</label><input className="inp" type="number" min={0} placeholder="optional — negotiated reduction" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
              ) : (
                <div><label className="f">Additional Charges (₹)</label>
                  <input className="inp" type="number" min={0} placeholder="optional — e.g. late fee, documentation charge" value={fee} onChange={(e) => setFee(e.target.value)} />
                </div>
              )}
              <div><label className="f">Description</label>
                <input className="inp" placeholder="Optional note for the ledger" value={description} onChange={(e) => setDescription(e.target.value)} disabled={releaseRequestId != null} />
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
