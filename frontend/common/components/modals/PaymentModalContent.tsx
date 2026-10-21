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
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";

// What Amount is allowed to pay off. Every mode clears the fee first; the backend rejects an overshoot of the buckets the mode is allowed to touch (allocatePayment/ErrExceedsOutstanding).
// Waterfall order per mode: Partial fee→penal→interest→principal; Interest fee→penal→interest; Penal Interest fee→penal; Principal fee→principal; Full Settlement everything owed.
// Adjustment/Waiver and auction types are deliberately absent — the backend refuses them on this endpoint.
const ALLOCATION_MODES = [
  { value: "Partial", label: "Both — interest, then principal" },
  { value: "Interest", label: "Interest only" },
  { value: "Penal Interest", label: "Penal interest only" },
  { value: "Principal", label: "Principal only" },
  { value: "Full Settlement", label: "Full settlement — close the loan" },
];

// Mirrors backend service.go's allocatePayment so staff see where Amount lands before recording; the backend remains the authority and still rejects an overshoot.
// `over` is what didn't fit any bucket the mode allows (ErrExceedsOutstanding); for Full Settlement the ceiling is everything owed.
function previewAllocation(loan: LoanView, mode: string, amount: number) {
  const feeOwed = loan.outstandingProcessingFee;
  const penalOwed = loan.outstandingPenalInterest;
  const interestOwed = loan.outstandingInterest;
  const principalOwed = loan.outstanding;

  if (mode === "Full Settlement") {
    const total = feeOwed + penalOwed + interestOwed + principalOwed;
    return { fee: feeOwed, penal: penalOwed, interest: interestOwed, principal: principalOwed, over: Math.max(0, amount - total), short: Math.max(0, total - amount) };
  }

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

// Posts to POST /loans/:id/payments. Default "Both" mode is the backend's "Partial" waterfall (fee→penal→interest→principal); covering everything owed auto-closes the loan.
// Adjustment/Waiver are deliberately not reachable from this modal — a scope decision, not an oversight.
// A processing fee entered here is added to the loan's owed fee BEFORE Amount is allocated, so this payment's Amount pays it off first — not extra cash on top of Amount.
// releaseRequestId routes this form at the release-payment endpoint instead and reveals a Discount field, otherwise identical — kept as one component rather than a duplicate modal.
// initialMode preselects "Apply Payment To" (e.g. the top-up modal's "pay interest first" redirect); ignored if not one of ALLOCATION_MODES.

// Prefilled money figures are accrued/prorated, so they carry long decimals — show to the paisa.
const prefill = (v: number) => (v > 0 ? String(Math.round(v * 100) / 100) : "");

// Which field a server message is about, by its words (first match wins).
const SERVER_FIELDS: Record<string, RegExp> = {
  discount: /discount/i, fee: /processing fee|additional charge/i, interest: /interest cannot|interest override/i, date: /date/i, split: /bank|breakdown|split|cheque|upi|cash/i, amount: /amount|exceed|outstanding/i,
};

type PaymentModalContentProps = { loan: LoanView; onSaved: () => void; releaseRequestId?: number; initialMode?: string };

// Record Payment never posts straight away: it first pops a confirmation
// summary (amount, where it lands, how it was paid) on top of the form, and
// only that popup's Confirm Payment actually records it.
export function PaymentModalContent({ loan: initialLoan, onSaved, releaseRequestId, initialMode }: PaymentModalContentProps) {
  const { closeModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const startMode = ALLOCATION_MODES.some((m) => m.value === initialMode) ? initialMode! : ALLOCATION_MODES[0].value;

  // The caller's `loan` prop can be stale (LoanDetail.tsx only re-fetches on an explicit action); re-fetch on mount so the shown interest reflects what's accrued up to now.
  const [loan, setLoan] = useState(initialLoan);
  useEffect(() => {
    let cancelled = false;
    getLoan(initialLoan.numericId).then((fresh) => {
      if (cancelled) return;
      setLoan(fresh);
      // Don't clobber a figure the user has already started typing.
      if (!interestTouchedRef.current) setInterestRaw(prefill(fresh.outstandingInterest));
    }).catch(() => { /* keep the possibly-stale prop rather than blocking the form */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLoan.numericId]);

  // What's owed in the bucket(s) the picked mode reaches, so picking a mode fills in what it would fully clear.
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
  // Once the user touches Amount by hand, stop overwriting it with a prefill — same rule as interestTouchedRef below.
  const amountTouchedRef = useRef(false);
  // Narrower modes always refill Amount with what they clear (a stale typed figure would overshoot); only "Both" keeps a typed amount. The refill itself lives in the effect below.
  function selectMode(nextMode: string) {
    setMode(nextMode);
  }
  function setAmount(v: string) {
    amountTouchedRef.current = true;
    setAmt(v);
  }
  // Prefilled from the live calculation but editable — staff may charge a different actual amount. Cleared by hand means "use whatever the system calculates".
  const [interest, setInterestRaw] = useState(prefill(initialLoan.outstandingInterest));
  const interestTouchedRef = useRef(false);
  function setInterest(v: string) {
    interestTouchedRef.current = true;
    setInterestRaw(v);
  }
  const [mode, setMode] = useState(startMode);
  const [fee, setFee] = useState("");
  const [date, setDate] = useState(today);
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [remaining, setRemaining] = useState(0);
  const [bankId, setBankId] = useState<number | undefined>(undefined);
  // Release-context only: a negotiated reduction with no cash movement, posted as its own PaymentTypeDiscount ledger entry.
  const [discount, setDiscount] = useState("");
  // An error is stamped with the figures as they were when raised and stops showing once any of them change.
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
  // Synchronous guard against a double post: `saving` alone only disables the button after a re-render. "done" stays set since this component outlives closeModal.
  const postRef = useRef<"idle" | "posting" | "done">("idle");
  // True while the confirmation popup is open over the form (which stays as-is underneath, so Back keeps everything entered).
  const [confirming, setConfirming] = useState(false);

  // Amount is the total cash handed over — picked bucket(s) plus any Additional Charges — so the preview must account for the fee the same way allocation will.
  const charge = +fee > 0 ? +fee : 0;
  const previewAmount = +amt > 0 ? +amt : 0;
  // An Interest override replaces the computed interest server-side; preview uses it the same way.
  const previewLoan = {
    ...loan,
    outstandingProcessingFee: loan.outstandingProcessingFee + (+fee || 0),
    outstandingInterest: interest.trim() && +interest >= 0 ? +interest : loan.outstandingInterest,
  };
  const alloc = previewAllocation(previewLoan, mode, previewAmount);
  const interestForAmount = interest.trim() && +interest >= 0 ? +interest : loan.outstandingInterest;
  const modeTotal = amountForMode({ ...loan, outstandingInterest: interestForAmount, settlementAmount: loan.settlementAmount - loan.outstandingInterest + interestForAmount }, mode) + charge;
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
    if (processingFee > amount + 0.001) { setErr("Additional charges cannot exceed the amount.", "fee"); return; }
    const interestOverride = interest.trim() ? +interest : undefined;
    if (interestOverride != null && interestOverride < 0) { setErr("Interest cannot be negative.", "interest"); return; }
    if (!date) { setErr("Please select the payment date.", "date"); return; }
    if (!splitBalanced) { setErr("The payment breakdown must add up to the amount.", "split"); return; }
    if (bankMissing) { setErr("Select a bank", "split"); return; }
    if (allocWarning) { setErr(allocWarning, "amount"); return; }
    const discountAmount = discount.trim() ? +discount : 0;
    if (discountAmount < 0) { setErr("Discount cannot be negative.", "discount"); return; }
    if (discountAmount > amount) { setErr("Discount cannot exceed the amount.", "discount"); return; }
    if (!confirming) { setErr(""); setConfirming(true); return; }
    if (postRef.current !== "idle") return;
    postRef.current = "posting";
    setSaving(true);
    try {
      // The receiving employee is derived server-side from the JWT — no employeeId sent from here.
      if (releaseRequestId != null) {
        // RecordReleaseRequestPayment applies the discount as its own ledger entry FIRST, reducing outstanding balance before this call runs — net it out here or the undiscounted amount overshoots and gets rejected.
        const cashAmount = Math.round((amount - discountAmount) * 100) / 100;
        // interestOverride is a snapshot from modal-open time; once a discount reduces outstanding interest first, that stale figure mismatches the real total, so suppress it unless the user explicitly edited the field.
        const effectiveInterestOverride = discountAmount > 0 && !interestTouchedRef.current ? undefined : interestOverride;
        // The split was entered against the full pre-discount amount, so scale it down by the same ratio to sum to cashAmount (ValidateSplit requires parts to sum to the whole).
        const splitRatio = amount > 0 ? cashAmount / amount : 0;
        const scaledSplit = cashAmount <= 0.01 ? ZERO_SPLIT : {
          cashAmount: Math.round(split.cashAmount * splitRatio * 100) / 100,
          upiAmount: Math.round(split.upiAmount * splitRatio * 100) / 100,
          bankTransferAmount: Math.round(split.bankTransferAmount * splitRatio * 100) / 100,
          chequeAmount: Math.round(split.chequeAmount * splitRatio * 100) / 100,
        };
        // Rounding drift across the four components is folded into cash so the sum check doesn't reject it.
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
      // closeModal only hides the shared shell; drop the portalled popup explicitly.
      postRef.current = "done";
      setConfirming(false);
      onSaved();
      closeModal();
      toast(`Payment of ${fmt(amount)} recorded${processingFee ? ` (incl. ${fmt(processingFee)} processing fee charged)` : ""}`);
    } catch (e) {
      // A throw after the post succeeded (e.g. from onSaved) must not re-open the door.
      if (postRef.current === "done") return;
      postRef.current = "idle";
      const msg = e instanceof ApiError ? e.message : "Could not record the payment — try again.";
      setErr(msg, fieldForMessage(msg, SERVER_FIELDS));
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  }); }

  // Live receipt figures: what's left on the loan once previewAllocation's split lands.
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
      {/* bd-scroll caps the modal at the viewport and scrolls this body; Select's option list is position:fixed so it isn't clipped. */}
      <div className="bd bd-scroll">
        <div className="pay-layout">
          <div className="pay-form">
            <div className="pay-sec">
              <div className="pay-sec-t">Payment</div>
              <div className="frow"><div className={fe.mode ? "has-err" : undefined}><label className="f">Apply Payment To *</label>
                <Select options={ALLOCATION_MODES.map((m) => ({ value: m.value, label: m.label }))} value={mode} onChange={selectMode} /><FieldError msg={fe.mode} />
              </div></div>
              <div className="frow c2">
                <div className={fe.date ? "has-err" : undefined}><label className="f">Payment Date *</label><DatePicker value={date} onChange={(v) => { clearField("date"); setDate(v); }} /><FieldError msg={fe.date} /></div>
                <div className={fe.interest ? "has-err" : undefined}><label className="f">Interest (₹)</label>
                  <input className="inp" type="number" min={0} value={interest} onChange={(e) => setInterest(e.target.value)} /><FieldError msg={fe.interest} />
                </div>
              </div>
              <div className="frow c2">
                {releaseRequestId != null ? (
                  <div className={fe.discount ? "has-err" : undefined}><label className="f">Discount (₹)</label><input className="inp" type="number" min={0} placeholder="optional — negotiated reduction" value={discount} onChange={(e) => setDiscount(e.target.value)} /><FieldError msg={fe.discount} /></div>
                ) : (
                  <div className={fe.fee ? "has-err" : undefined}><label className="f">Additional Charges (₹)</label>
                    <input className="inp" type="number" min={0} placeholder="e.g. late fee" value={fee} onChange={(e) => setFee(e.target.value)} /><FieldError msg={fe.fee} />
                  </div>
                )}
                <div className={fe.amount ? "has-err" : undefined}>
                  <label className="f">Amount (₹) *</label>
                  <input className="inp pay-amt" type="number" min={1} placeholder="e.g. 5000" value={amt} onChange={(e) => setAmount(e.target.value)} /><FieldError msg={fe.amount} />
                </div>
              </div>
            </div>

            <div className="pay-sec">
              <div className="pay-sec-t">Payment breakdown <small>How the customer paid</small></div>
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
        {/* Never a silently disabled button: whatever is blocking Review is spelled out here. */}
        <span className="pay-ft-msg">{(Object.keys(fe).length ? "" : allocWarning || (bankMissing ? "Select a bank" : "")) || err}</span>
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving || confirming || alloc.over > 0.01 || bankMissing}><Icon name="check" /> Review {previewAmount > 0 ? fmt(previewAmount) : "Payment"}</button>
      </div>
      {/* Portalled to <body> so it stacks over the modal as its own popup; React events still bubble so the shared Enter-to-submit handler sees the focused Confirm button. */}
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
              {/* Plain top-to-bottom list: payment info, what it paid off, then the total. No boxes, just rules between groups. */}
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
