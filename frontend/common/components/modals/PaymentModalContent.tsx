"use client";

import { useEffect, useRef, Fragment, useState } from "react";
import { createPortal } from "react-dom";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { Select } from "@/common/components/ui/Select";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/common/components/SplitPaymentInput";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { fmt, fmtDate as fmtDisplayDate } from "@/common/utils/format";
import { recordPayment, recordReleasePayment, getLoan } from "@/modules/loans/services/loanService";
import { type LoanView } from "@/modules/loans/types/loan-types";
import { ApiError } from "@/common/services/httpClient";
import { singleFlight } from "@/common/utils/singleFlight";

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
 * for Full Settlement the ceiling is everything owed (incl. any additional
 * charge): SHORT below it, OVER above it. */
function previewAllocation(loan: LoanView, mode: string, amount: number) {
  const feeOwed = loan.outstandingProcessingFee;
  const penalOwed = loan.outstandingPenalInterest;
  const interestOwed = loan.outstandingInterest;
  const principalOwed = loan.outstanding;

  if (mode === "Full Settlement") {
    const total = feeOwed + penalOwed + interestOwed + principalOwed;
    return { fee: feeOwed, penal: penalOwed, interest: interestOwed, principal: principalOwed, over: Math.max(0, amount - total), short: Math.max(0, total - amount) };
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
//
// initialMode preselects "Apply Payment To" (and so the prefilled Amount) —
// e.g. the top-up modal's "pay the interest first" redirect opens this on
// "Interest". Ignored if it isn't one of ALLOCATION_MODES.

// Prefilled money figures are accrued/prorated, so they carry long decimals —
// show them to the paisa.
const prefill = (v: number) => (v > 0 ? String(Math.round(v * 100) / 100) : "");

type PaymentModalContentProps = { loan: LoanView; onSaved: () => void; releaseRequestId?: number; initialMode?: string };

// Record Payment never posts straight away: it first pops a confirmation
// summary (amount, where it lands, how it was paid) on top of the form, and
// only that popup's Confirm Payment actually records it.
export function PaymentModalContent({ loan: initialLoan, onSaved, releaseRequestId, initialMode }: PaymentModalContentProps) {
  const { closeModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const startMode = ALLOCATION_MODES.some((m) => m.value === initialMode) ? initialMode! : ALLOCATION_MODES[0].value;

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
      if (!interestTouchedRef.current) setInterestRaw(prefill(fresh.outstandingInterest));
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
    const v = amountForMode(initialLoan, startMode);
    return v > 0 ? prefill(v) : "";
  });
  // Set the instant a mode is picked, before the user has typed their own
  // Amount — once they touch the field by hand this stops overwriting it, same
  // "prefill, don't fight an edit" rule as the Interest field's own
  // interestTouchedRef below.
  const amountTouchedRef = useRef(false);
  // Picking a narrower mode (Interest/Penal/Principal/Full Settlement) always
  // refills Amount with what that mode clears — keeping a typed figure made
  // the picker look broken (the receipt still showed the old amount, now
  // overshooting the new mode). Only "Both" keeps a typed amount, since any
  // figure is valid there.
  // The Amount refill itself lives in the effect below (it also depends on
  // Interest and Additional Charges), so picking a mode only sets the mode.
  function selectMode(nextMode: string) {
    setMode(nextMode);
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
  const [interest, setInterestRaw] = useState(prefill(initialLoan.outstandingInterest));
  const interestTouchedRef = useRef(false);
  function setInterest(v: string) {
    interestTouchedRef.current = true;
    setInterestRaw(v);
  }
  // Defaults to the full waterfall, which is what every payment did before
  // this picker existed — so leaving it alone reproduces the old behaviour.
  const [mode, setMode] = useState(startMode);
  const [fee, setFee] = useState("");
  const [date, setDate] = useState(today);
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [remaining, setRemaining] = useState(0);
  const [bankId, setBankId] = useState<number | undefined>(undefined);
  // Release-context only (releaseRequestId set) — a negotiated reduction
  // with no cash movement, posted alongside the payment as a real
  // PaymentTypeDiscount ledger entry (see backend/internal/loan/service.go's
  // RecordReleaseRequestPayment).
  const [discount, setDiscount] = useState("");
  // An error is about the figures as they were when it was raised — it's
  // stamped with them and stops showing the moment any of them change.
  const figuresKey = [amt, mode, remaining, fee, interest, discount].join("|");
  const [errState, setErrState] = useState({ msg: "", key: "" });
  const err = errState.key === figuresKey ? errState.msg : "";
  const setErr = (msg: string) => setErrState({ msg, key: figuresKey });
  const [saving, setSaving] = useState(false);
  // Synchronous guard against a double post: `saving` only disables the
  // button after a re-render, so a fast double-click or a held Enter on the
  // focused Confirm button could call save() twice before that. "done"
  // stays set after success — this component outlives closeModal (the
  // shell only hides it), so nothing may record a second time.
  const postRef = useRef<"idle" | "posting" | "done">("idle");
  // True while the confirmation popup is open over the form. The form stays
  // as-is underneath, so going Back keeps everything entered.
  const [confirming, setConfirming] = useState(false);

  // A fee entered here is added to the loan's owed fee BEFORE Amount is
  // allocated (see this component's doc comment), so the preview has to see
  // it too or it would under-report what the fee bucket swallows.
  // Additional Charges are collected ON TOP of Amount — the customer pays
  // Amount + charges, and the charge settles the fee bucket so none of Amount
  // is eaten by it. previewAmount is that total cash handed over.
  // Amount is the total cash handed over — the picked bucket(s) PLUS any
  // Additional Charges — so the figure typed/prefilled here is what the
  // customer pays and what gets recorded.
  const charge = +fee > 0 ? +fee : 0;
  const previewAmount = +amt > 0 ? +amt : 0;
  // An Interest override replaces the computed interest server-side (see
  // PaymentInput.InterestOverride), so the preview uses it the same way.
  const previewLoan = {
    ...loan,
    outstandingProcessingFee: loan.outstandingProcessingFee + (+fee || 0),
    outstandingInterest: interest.trim() && +interest >= 0 ? +interest : loan.outstandingInterest,
  };
  const alloc = previewAllocation(previewLoan, mode, previewAmount);
  // Prefill Amount with what the picked option owes (interest override
  // respected) plus the Additional Charges. "Both" keeps a hand-typed figure
  // since any amount is valid there.
  const interestForAmount = interest.trim() && +interest >= 0 ? +interest : loan.outstandingInterest;
  const modeTotal = amountForMode({ ...loan, outstandingInterest: interestForAmount, settlementAmount: loan.settlementAmount - loan.outstandingInterest + interestForAmount }, mode) + charge;
  useEffect(() => {
    if (mode === "Partial" && amountTouchedRef.current) return;
    setAmt(modeTotal > 0 ? prefill(modeTotal) : "");
  }, [mode, modeTotal]);
  const splitBalanced = Math.abs(remaining) < 0.01;

  async function save() { return singleFlight("modal:payment:save", async () => {
    const typed = +amt;
    if (!typed || typed <= 0) { setErr("Please enter a valid payment amount."); return; }
    const processingFee = fee.trim() ? +fee : 0;
    if (processingFee < 0) { setErr("Processing fee cannot be negative."); return; }
    const amount = typed;
    if (processingFee > amount + 0.001) { setErr("Additional charges cannot exceed the amount."); return; }
    const interestOverride = interest.trim() ? +interest : undefined;
    if (interestOverride != null && interestOverride < 0) { setErr("Interest cannot be negative."); return; }
    if (!date) { setErr("Please select the payment date."); return; }
    if (!splitBalanced) { setErr("The payment breakdown must add up to the amount."); return; }
    if (bankMissing) { setErr("Select a bank"); return; }
    if (allocWarning) { setErr(allocWarning); return; }
    const discountAmount = discount.trim() ? +discount : 0;
    if (discountAmount < 0) { setErr("Discount cannot be negative."); return; }
    if (discountAmount > amount) { setErr("Discount cannot exceed the amount."); return; }
    if (!confirming) { setErr(""); setConfirming(true); return; }
    if (postRef.current !== "idle") return;
    postRef.current = "posting";
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
          interestOverride,
        });
      }
      // closeModal only hides the shared shell — this component stays
      // mounted, so the portalled popup has to be dropped explicitly.
      postRef.current = "done";
      setConfirming(false);
      onSaved();
      closeModal();
      toast(`Payment of ${fmt(amount)} recorded${processingFee ? ` (incl. ${fmt(processingFee)} processing fee charged)` : ""}`);
    } catch (e) {
      // A throw after the post succeeded (e.g. from onSaved) must not
      // re-open the door; only a rejected post allows a corrected retry.
      if (postRef.current === "done") return;
      postRef.current = "idle";
      setErr(e instanceof ApiError ? e.message : "Could not record the payment — try again.");
      // Back to the form so the rejected figures can be corrected.
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  }); }

  // Live receipt figures (the right-hand panel) — what's left on the loan
  // once previewAllocation's split lands, against the same fee-and-override
  // adjusted previewLoan it allocated from.
  const paidBy = ([
    ["Cash", split.cashAmount],
    ["UPI", split.upiAmount],
    ["Bank transfer", split.bankTransferAmount],
    ["Cheque", split.chequeAmount],
  ] as const).filter(([, v]) => v > 0.001);
  const allocRows = ([
    ["Processing fee / charges", alloc.fee, "var(--accent)"],
    ["Penal interest", alloc.penal, "var(--red)"],
    ["Interest", alloc.interest, "var(--brand)"],
    ["Principal", alloc.principal, "var(--green)"],
  ] as const).filter(([, v]) => v > 0.001);
  const principalLeft = Math.max(0, previewLoan.outstanding - alloc.principal);
  const interestLeft = Math.max(0, previewLoan.outstandingInterest + previewLoan.outstandingPenalInterest - alloc.interest - alloc.penal);
  const feeLeft = Math.max(0, previewLoan.outstandingProcessingFee - alloc.fee);
  const closesLoan = previewAmount > 0 && alloc.short < 0.01 && principalLeft + interestLeft + feeLeft < 0.01;
  // UPI / Bank Transfer money has to say which bank it went through.
  const bankMissing = split.upiAmount + split.bankTransferAmount > 0 && !bankId;
  const allocWarning = alloc.over > 0.01
    ? `Amount greater than ${modeShort(mode)}`
    : alloc.short > 0.01
      ? `${fmt(alloc.short)} short. Closing the loan needs the full ${fmt(previewAmount + alloc.short)}.`
      : "";

  return (
    <>
      <div className="hd"><h3>Record Payment — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      {/* `bd-scroll` caps the modal at the viewport and scrolls THIS body
        * instead of the page behind it (see app.css). Select's option list
        * is position:fixed, so the scrolling body can't clip it. */}
      <div className="bd bd-scroll">
        <div className="pay-layout">
          <div className="pay-form">
            <div className="pay-sec">
              <div className="pay-sec-t">Payment</div>
              <div className="frow"><div><label className="f">Apply Payment To *</label>
                <Select options={ALLOCATION_MODES.map((m) => ({ value: m.value, label: m.label }))} value={mode} onChange={selectMode} />
              </div></div>
              <div className="frow c2">
                <div><label className="f">Payment Date *</label><DatePicker value={date} onChange={setDate} /></div>
                <div><label className="f">Interest (₹)</label>
                  <input className="inp" type="number" min={0} value={interest} onChange={(e) => setInterest(e.target.value)} />
                </div>
              </div>
              <div className="frow c2">
                {releaseRequestId != null ? (
                  <div><label className="f">Discount (₹)</label><input className="inp" type="number" min={0} placeholder="optional — negotiated reduction" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
                ) : (
                  <div><label className="f">Additional Charges (₹)</label>
                    <input className="inp" type="number" min={0} placeholder="e.g. late fee" value={fee} onChange={(e) => setFee(e.target.value)} />
                  </div>
                )}
                <div>
                  <label className="f">Amount (₹) *</label>
                  <input className="inp pay-amt" type="number" min={1} placeholder="e.g. 5000" value={amt} onChange={(e) => setAmount(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="pay-sec">
              <div className="pay-sec-t">Payment breakdown <small>How the customer paid</small></div>
              <SplitPaymentInput totalAmount={previewAmount} onChange={(s, r, b) => { setSplit(s); setRemaining(r); setBankId(b); }} scrollInternally={false} label={null} />
            </div>

          </div>

          <aside className="pay-receipt">
            <div className="pay-r-cap">Customer pays</div>
            <div className="pay-r-big">{fmt(previewAmount)}</div>
            <div className="pay-r-cap">{fmtDate(date)} · {paidBy.length ? paidBy.map(([l]) => l).join(" + ") : "—"}</div>

            <div className="pay-r-h">Goes towards</div>
            {allocRows.length > 0 ? (
              <>
                <div className="pay-bar">
                  {allocRows.map(([label, v, color]) => <i key={label} style={{ width: `${(v / Math.max(previewAmount, 1)) * 100}%`, background: color }} />)}
                </div>
                {allocRows.map(([label, v, color]) => (
                  <div className="pay-r-row" key={label}>
                    <span><i className="pay-dot" style={{ background: color }} />{label}</span><b>{fmt(v)}</b>
                  </div>
                ))}
              </>
            ) : (
              <div className="pay-r-row" style={{ color: "var(--muted)" }}>Enter an amount</div>
            )}

            <div className="pay-r-h pay-r-div">Left on the loan</div>
            <div className="pay-r-row"><span style={{ color: "var(--muted)" }}>Principal</span><b>{fmt(principalLeft)}</b></div>
            <div className="pay-r-row"><span style={{ color: "var(--muted)" }}>Interest{previewLoan.outstandingPenalInterest > 0 ? " + penal" : ""}</span><b>{fmt(interestLeft)}</b></div>
            {feeLeft > 0.01 && <div className="pay-r-row"><span style={{ color: "var(--muted)" }}>Fees / charges</span><b>{fmt(feeLeft)}</b></div>}
            {closesLoan && <div className="pay-r-ok"><Icon name="check" /> Loan will be closed</div>}
          </aside>
        </div>
      </div>
      <div className="ft">
        {/* Never a silently disabled button: whatever is blocking Review
          * (or the server's last rejection) is spelled out here. */}
        <span className="pay-ft-msg">{allocWarning || (bankMissing ? "Select a bank" : "") || err}</span>
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving || confirming || alloc.over > 0.01 || bankMissing}><Icon name="check" /> Review {previewAmount > 0 ? fmt(previewAmount) : "Payment"}</button>
      </div>
      {/* Portalled to <body> so it stacks over the whole Record Payment modal
        * as its own smaller popup instead of replacing its content. React
        * events still bubble to the payment modal, so its shared Enter-to-
        * submit handler sees the focused Confirm button and leaves it alone. */}
      {confirming && createPortal(
        <div
          className="modal-bg open pay-confirm-bg"
          onClick={(e) => { if (e.target === e.currentTarget && !saving) setConfirming(false); }}
          onKeyDown={(e) => { if (e.key === "Escape" && !saving) setConfirming(false); }}
        >
          <div className="modal" role="dialog" aria-modal="true">
            <div className="hd"><h3>Confirm Payment</h3><button className="x" onClick={() => setConfirming(false)} disabled={saving}>×</button></div>
            <div className="bd bd-scroll">
              <div style={{ textAlign: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Amount to be paid</div>
                <div style={{ fontSize: 26, fontWeight: 700 }}>{fmt(previewAmount)}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{loan.id} · {loan.customerName}</div>
              </div>
              {/* One plain list, top to bottom: what the payment is for and how it was paid, then what it
                * paid in the order the loan is cleared (penal interest, interest, charges, principal),
                * then the total being paid. No boxes — rules between the groups only. */}
              {(() => {
                const row = (label: string, value: string, opts?: { indent?: boolean; strong?: boolean; color?: string }) => (
                  <Fragment key={label}>
                    <span style={{ paddingLeft: opts?.indent ? 16 : 0, color: opts?.indent ? "var(--muted)" : undefined }}>{label}</span>
                    <b style={{ textAlign: "right", color: opts?.color, fontSize: opts?.strong ? 15 : undefined }}>{value}</b>
                  </Fragment>
                );
                const applied: [string, number, string][] = [
                  ["Penal interest", alloc.penal, "var(--red)"],
                  ["Interest", alloc.interest, "var(--brand)"],
                  ["Additional charges", alloc.fee, "var(--accent)"],
                  ["Principal", alloc.principal, "var(--green)"],
                ];
                const rule = { borderTop: "1px solid var(--line, #e3e6ee)", marginTop: 10, paddingTop: 10 } as const;
                const grid = { display: "grid", gridTemplateColumns: "1fr auto", gap: "6px 16px", fontSize: 13 } as const;
                return (
                  <>
                    <div style={grid}>
                      {row("Apply payment to", modeLabel(mode))}
                      {row("Payment date", fmtDate(date))}
                      {paidBy.map(([label, v]) => row(`Paid by ${label}`, fmt(v), { indent: true }))}
                    </div>
                    <div style={rule}>
                      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>Applied as</div>
                      <div style={grid}>
                        {applied.filter(([, v]) => v > 0.001).map(([label, v, color]) => row(label, fmt(v), { indent: true, color }))}
                        {+discount > 0 && row("Discount", fmt(+discount), { indent: true })}
                      </div>
                    </div>
                    <div style={rule}>
                      <div style={grid}>{row("Amount paying", fmt(previewAmount), { strong: true })}</div>
                    </div>
                  </>
                );
              })()}
            </div>
            <div className="ft">
              <button className="btn ghost" onClick={() => setConfirming(false)} disabled={saving}>Back</button>
              <button className="btn" onClick={save} disabled={saving} autoFocus><Icon name="check" /> {saving ? "Recording…" : "Confirm Payment"}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// What the chosen option can take, in a word or two, for the over-payment message.
function modeShort(mode: string) {
  switch (mode) {
    case "Interest": return "interest";
    case "Penal Interest": return "penal interest";
    case "Principal": return "principal";
    default: return "amount due";
  }
}

function modeLabel(mode: string) {
  return ALLOCATION_MODES.find((m) => m.value === mode)?.label ?? mode;
}

// "2026-10-01" → "01-10-2026"; "No date" until one is picked.
function fmtDate(iso: string) {
  return iso ? fmtDisplayDate(iso) : "No date";
}
