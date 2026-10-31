"use client";

import { useEffect, useRef, Fragment, useState } from "react";
import { createPortal } from "react-dom";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { Select } from "@/common/components/ui/Select";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/common/components/SplitPaymentInput";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { fmt, fmtDate as fmtDisplayDate, roundRupee } from "@/common/utils/format";
import { recordPayment, recordReleasePayment, getLoan } from "@/modules/loans/services/loanService";
import { type LoanView, type DiscountKind, DISCOUNT_KIND_LABELS } from "@/modules/loans/types/loan-types";
import { ApiError } from "@/common/services/httpClient";
import { singleFlight } from "@/common/utils/singleFlight";
import { useAuth } from "@/common/providers/AuthProvider";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";

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
const prefill = (v: number) => (v > 0 ? String(roundRupee(v)) : "");

// Which field a server message is about, by its words (first match wins).
const SERVER_FIELDS: Record<string, RegExp> = {
  discount: /discount/i, fee: /processing fee|additional charge/i, interest: /interest cannot|interest override/i, date: /date/i, split: /bank|breakdown|split|cheque|upi|cash/i, amount: /amount|exceed|outstanding/i,
};

// releaseMinFor (release context only) gives the least that must be paid to release the gold, from the freshly fetched loan.
// It prefills Amount, and Amount can't go below it (the backend checks the same figure).
type PaymentModalContentProps = { loan: LoanView; onSaved: () => void; releaseRequestId?: number; initialMode?: string; releaseMinFor?: (loan: LoanView) => number; initialDate?: string };

// Record Payment never posts straight away: it first pops a confirmation
// summary (amount, where it lands, how it was paid) on top of the form, and
// only that popup's Confirm Payment actually records it.
export function PaymentModalContent({ loan: initialLoan, onSaved, releaseRequestId, initialMode, releaseMinFor, initialDate }: PaymentModalContentProps) {
  const { closeModal } = useModal();
  const toast = useToast();
  const { can } = useAuth();
  const canDiscount = can("Loan_Management", "can_give_discount");
  // Local calendar day, not UTC — toISOString() flips to tomorrow/yesterday around midnight in India.
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
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

  const releaseMin = releaseRequestId != null && releaseMinFor ? roundRupee(releaseMinFor(loan)) : null;
  const [amt, setAmt] = useState(() => {
    const v = releaseRequestId != null && releaseMinFor ? roundRupee(releaseMinFor(initialLoan)) : amountForMode(initialLoan, startMode);
    return v > 0 ? prefill(v) : "";
  });
  // Set the instant a mode is picked, before the user has typed their own
  // Amount — once they touch the field by hand this stops overwriting it, same
  // "prefill, don't fight an edit" rule as the Interest field's own
  // interestTouchedRef below.
  const amountTouchedRef = useRef(false);
  const [amountTyped, setAmountTyped] = useState(false);
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
    setAmountTyped(true);
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
  const [date, setDate] = useState(initialDate || today);
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [remaining, setRemaining] = useState(0);
  const [bankId, setBankId] = useState<number | undefined>(undefined);
  // Release-context only (releaseRequestId set) — a negotiated reduction
  // with no cash movement, posted alongside the payment as a real
  // PaymentTypeDiscount ledger entry (see backend/internal/loan/service.go's
  // RecordReleaseRequestPayment).
  // Discount: a negotiated reduction with no cash movement, saved as its own Discount ledger entry (a company
  // write-off). Amount stays what the customer actually pays; Amount + Discount clears the loan. It needs a
  // reason, and a mode so the entry shows under the right ledger mode.
  const [discount, setDiscount] = useState("");
  // What the discount is given against: a customer discount (falls through penal interest, interest, principal), or
  // interest / penal interest only.
  const [discountKind, setDiscountKind] = useState<DiscountKind>("customer");
  // Choosing what the discount is for fills the amount with what is still owed of it (interest, or penal interest);
  // a customer discount is a figure the staff member types. The amount can still be changed.
  function chooseDiscountKind(k: DiscountKind) {
    setDiscountKind(k);
    if (k === "interest") setDiscount(prefill(loan.outstandingInterest));
    else if (k === "penal_interest") setDiscount(prefill(loan.outstandingPenalInterest));
    else setDiscount("");
  }
  // An error is about the figures as they were when it was raised — it's
  // stamped with them and stops showing the moment any of them change.
  const figuresKey = [amt, mode, remaining, fee, interest, discount].join("|");
  // `field` is the input the message is about; "" means it fits no field and shows in the footer.
  const [errState, setErrState] = useState({ msg: "", field: "", key: "" });
  const errLive = errState.key === figuresKey;
  const err = errLive && !errState.field ? errState.msg : "";
  const fe: Record<string, string> = errLive && errState.field ? { [errState.field]: errState.msg } : {};
  const setErr = (msg: string, field = "") => setErrState({ msg, field, key: figuresKey });
  // Editing the date or the payment breakdown doesn't change the figures key, so clear those by hand.
  const clearField = (f: string) => setErrState((cur) => (cur.field === f ? { msg: "", field: "", key: "" } : cur));
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
  // An Interest override replaces the computed interest server-side (see
  // PaymentInput.InterestOverride), so the preview uses it the same way.
  const previewLoan = {
    ...loan,
    outstandingProcessingFee: loan.outstandingProcessingFee + (+fee || 0),
    outstandingInterest: interest.trim() && +interest >= 0 ? +interest : loan.outstandingInterest,
  };
  // Release context: Amount is what the customer pays after the discount, so the allocation preview (and the
  // over/short checks) run against payment + discount, which together clear the loan.
  const discountNum = canDiscount && +discount > 0 ? +discount : 0;
  // A discount moves no money; the ledger shows it as a Cash debit, so there is no mode to pick.
  const discountMode = "Cash";
  // Prefill Amount with what the picked option owes (interest override
  // respected) plus the Additional Charges. "Both" keeps a hand-typed figure
  // since any amount is valid there.
  const interestForAmount = interest.trim() && +interest >= 0 ? +interest : loan.outstandingInterest;
  // A release payment starts at what must be paid to release the gold, not at the whole settlement.
  // With a discount the Amount is what the customer actually pays: the figure minus the discount.
  const modeBase = mode === "Partial" && releaseMin != null
    ? releaseMin
    : amountForMode({ ...loan, outstandingInterest: interestForAmount, settlementAmount: loan.settlementAmount - loan.outstandingInterest + interestForAmount }, mode) + charge;
  const modeTotal = Math.max(0, roundRupee((modeBase - discountNum)));
  // Amount follows what the picked option owes (after the discount) in every mode but a hand-typed Partial, and the
  // field is only filled in by the effect below a render later. The preview and its warnings use that figure at once,
  // so changing the discount or the amount never flashes "amount greater than" against the old figure.
  const amountFollowsOwed = !(mode === "Partial" && amountTyped);
  const previewAmount = amountFollowsOwed ? modeTotal : +amt > 0 ? +amt : 0;
  const settledAmount = previewAmount + discountNum;
  const alloc = previewAllocation(previewLoan, mode, settledAmount);
  useEffect(() => {
    if (mode === "Partial" && amountTouchedRef.current) return;
    setAmt(modeTotal > 0 ? prefill(modeTotal) : "");
  }, [mode, modeTotal]);
  const splitBalanced = Math.abs(remaining) < 0.01;

  async function save() { return singleFlight("modal:payment:save", async () => {
    const typed = +amt;
    if (!typed || typed <= 0) { setErr("Please enter a valid payment amount.", "amount"); return; }
    const processingFee = fee.trim() ? +fee : 0;
    if (processingFee < 0) { setErr("Processing fee cannot be negative.", "fee"); return; }
    const amount = typed;
    const discountForMin = discount.trim() && +discount > 0 ? +discount : 0;
    if (releaseMin != null && amount + discountForMin < releaseMin - 0.005) { setErr(`${fmt(Math.max(0, releaseMin - discountForMin))} amount needed to release gold`, "amount"); return; }
    if (processingFee > amount + 0.001) { setErr("Additional charges cannot exceed the amount.", "fee"); return; }
    const interestOverride = interest.trim() ? +interest : undefined;
    if (interestOverride != null && interestOverride < 0) { setErr("Interest cannot be negative.", "interest"); return; }
    if (!date) { setErr("Please select the payment date.", "date"); return; }
    if (!splitBalanced) { setErr("The payment breakdown must add up to the amount.", "split"); return; }
    if (bankMissing) { setErr("Select a bank", "split"); return; }
    if (allocWarning) { setErr(allocWarning, "amount"); return; }
    const discountAmount = discount.trim() ? +discount : 0;
    if (discountAmount < 0) { setErr("Discount cannot be negative.", "discount"); return; }
    if (discountAmount > 0 && !canDiscount) { setErr("You don't have permission to give a discount.", "discount"); return; }
    if (releaseMin != null ? discountAmount > releaseMin + 0.005 : discountAmount > modeBase + 0.005) { setErr(releaseMin != null ? `Discount cannot exceed ${fmt(releaseMin)}, the amount needed to release the gold.` : `Discount cannot exceed ${fmt(modeBase)}, what this payment type clears.`, "discount"); return; }
    if (!confirming) { setErr(""); setConfirming(true); return; }
    if (postRef.current !== "idle") return;
    postRef.current = "posting";
    setSaving(true);
    try {
      // The receiving employee is derived server-side from the logged-in
      // user's JWT — no employeeId sent from here (see loansApi.ts's
      // PaymentInput doc comment).
      if (releaseRequestId != null) {
        // Amount is what the customer actually pays (settlement minus discount), sent as typed with the discount
        // alongside; the backend checks payment + discount covers what is needed. The discount is posted first and
        // lowers the balance, so the interest override prefilled at modal-open is only sent if hand-edited. The
        // payment breakdown was entered against this same Amount, so it is sent unscaled.
        const effectiveInterestOverride = discountAmount > 0 && !interestTouchedRef.current ? undefined : interestOverride;
        await recordReleasePayment(releaseRequestId, {
          amount, type: mode, discount: discountAmount || undefined, paidOn: date,
          discountReason: discountAmount > 0 ? "Discount" : undefined,
          discountMode: discountAmount > 0 ? discountMode : undefined,
          discountKind: discountAmount > 0 ? discountKind : undefined,
          cashAmount: split.cashAmount,
          upiAmount: split.upiAmount,
          bankTransferAmount: split.bankTransferAmount,
          chequeAmount: split.chequeAmount,
          bankId,
          interestOverride: effectiveInterestOverride,
        });
      } else {
        // The interest figure prefilled at modal-open is the pre-discount amount; with a discount the backend works
        // out interest after it, so that prefill is only sent when hand-edited (same rule as the release branch).
        await recordPayment(loan.numericId, {
          amount, type: mode, processingFee: processingFee || undefined, paidOn: date,
          discount: discountAmount || undefined,
          discountReason: discountAmount > 0 ? "Discount" : undefined,
          discountMode: discountAmount > 0 ? discountMode : undefined,
          discountKind: discountAmount > 0 ? discountKind : undefined,
          cashAmount: split.cashAmount,
          upiAmount: split.upiAmount,
          bankTransferAmount: split.bankTransferAmount,
          chequeAmount: split.chequeAmount,
          bankId,
          interestOverride: discountAmount > 0 && !interestTouchedRef.current ? undefined : interestOverride,
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
      const msg = e instanceof ApiError ? e.message : "Could not record the payment — try again.";
      setErr(msg, fieldForMessage(msg, SERVER_FIELDS));
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
              <div className="frow"><div className={fe.mode ? "has-err" : undefined}><label className="f">Apply Payment To *</label>
                <Select options={ALLOCATION_MODES.map((m) => ({ value: m.value, label: m.label }))} value={mode} onChange={selectMode} /><FieldError msg={fe.mode} />
              </div></div>
              <div className="frow c2">
                <div className={fe.date ? "has-err" : undefined}><label className="f">Payment Date *</label><DatePicker value={date} min={initialLoan.opened?.slice(0, 10) || undefined} max={today} onChange={(v) => { clearField("date"); setDate(v); }} /><FieldError msg={fe.date} /></div>
                <div className={fe.interest ? "has-err" : undefined}><label className="f">Interest (₹)</label>
                  <input className="inp" type="number" min={0} value={interest} onChange={(e) => setInterest(e.target.value)} /><FieldError msg={fe.interest} />
                </div>
              </div>
              {/* One c2 grid for Discount / Additional Charges / Reason / Mode, so they pair up 2-per-row with no half-empty row */}
              {(
                <div className="frow c2">
                  {canDiscount && (
                    <div><label className="f">Discount Type</label>
                      <Select options={(Object.keys(DISCOUNT_KIND_LABELS) as DiscountKind[]).map((k) => ({ value: k, label: DISCOUNT_KIND_LABELS[k] }))} value={discountKind} onChange={(v) => chooseDiscountKind(v as DiscountKind)} />
                    </div>
                  )}
                  {canDiscount && (
                    <div className={fe.discount ? "has-err" : undefined}><label className="f">Discount (₹)</label><input className="inp" type="number" min={0} placeholder={discountKind === "customer" ? "optional — negotiated reduction" : "filled from what is owed — change it if needed"} value={discount} onChange={(e) => setDiscount(e.target.value)} /><FieldError msg={fe.discount} /></div>
                  )}
                  {releaseRequestId == null && (
                    <div className={fe.fee ? "has-err" : undefined}><label className="f">Additional Charges (₹)</label>
                      <input className="inp" type="number" min={0} placeholder="e.g. late fee" value={fee} onChange={(e) => setFee(e.target.value)} /><FieldError msg={fe.fee} />
                    </div>
                  )}
                  <div className={fe.amount ? "has-err" : undefined}>
                    <label className="f">Amount (₹) *</label>
                    <input className="inp pay-amt" type="number" min={1} placeholder="e.g. 5000" value={amt} onChange={(e) => setAmount(e.target.value)} />
                    <FieldError msg={fe.amount} />
                  </div>
                </div>
              )}
            </div>

            <div className="pay-sec">
              <div className="pay-sec-t">Payment breakdown</div>
              <div className={fe.split ? "has-err" : undefined}>
                <SplitPaymentInput totalAmount={previewAmount} onChange={(s, r, b) => { clearField("split"); setSplit(s); setRemaining(r); setBankId(b); }} scrollInternally={false} label={null} />
                <FieldError msg={fe.split} />
              </div>
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
                  {allocRows.map(([label, v, color]) => <i key={label} style={{ width: `${(v / Math.max(settledAmount, 1)) * 100}%`, background: color }} />)}
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
            {discountNum > 0 && (
              <div className="pay-r-row"><span style={{ color: "var(--muted)" }}>Includes {DISCOUNT_KIND_LABELS[discountKind].toLowerCase()}</span><b>{fmt(discountNum)}</b></div>
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
        <span className="pay-ft-msg">{(Object.keys(fe).length ? "" : allocWarning || (bankMissing ? "Select a bank" : !splitBalanced ? "The payment breakdown must add up to the amount." : "")) || err}</span>
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving || confirming || alloc.over > 0.01 || bankMissing || !splitBalanced}><Icon name="check" /> Review {previewAmount > 0 ? fmt(previewAmount) : "Payment"}</button>
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
                        {discountNum > 0 && row(`${DISCOUNT_KIND_LABELS[discountKind]} discount`, fmt(discountNum), { indent: true })}
                      </div>
                    </div>
                    <div style={rule}>
                      <div style={grid}>
                        {row("Amount paying", fmt(previewAmount), { strong: true })}
                        {discountNum > 0 && row("Total cleared on the loan", fmt(settledAmount))}
                      </div>
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
