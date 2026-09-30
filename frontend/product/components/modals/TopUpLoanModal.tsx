"use client";

import { useState } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { Icon } from "@/product/components/Icon";
import { fmt } from "@/product/utils/format";
import { ApiError } from "@/product/services/httpClient";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/product/components/ui/SplitPaymentInput";
import { topUpLoan, getLoan, type LoanView } from "@/product/pages/loans/services/loanService";
import { EditLoanModalContent } from "@/product/components/modals/EditLoanModal";
import { PaymentModalContent } from "@/product/components/modals/PaymentModal";

/* Draws additional cash against an already-Active loan's spare eligible
 * value, without closing/reopening it — a single-step flow (no multi-stage
 * sanction chain). Shows current headroom (eligibleLoanAmount -
 * outstanding); if the requested amount exceeds it, the backend rejects
 * with ErrTopUpShortfall and this modal chains straight into the existing
 * "Edit Loan" ornament-add flow, then reopens itself once ornaments are
 * saved so the new (larger) headroom is visible without a second click. */
export function TopUpLoanModalContent({ loan, onSaved }: { loan: LoanView; onSaved: (updated: LoanView) => void }) {
  const { openModal, closeModal } = useModal();
  const toast = useToast();
  // liveLoan (not the loan prop directly) so arrears/headroom re-check
  // against a fresh figure after the Record Payment fallback below clears
  // some or all of the arrears mid-modal.
  const [liveLoan, setLiveLoan] = useState(loan);
  const headroom = Math.max(0, liveLoan.eligibleLoanAmount - liveLoan.outstanding);
  const arrears = (liveLoan.outstandingInterest ?? 0) + (liveLoan.outstandingPenalInterest ?? 0);
  const hasArrears = arrears > 0.01;

  const [amount, setAmount] = useState("");
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [remaining, setRemaining] = useState(0);
  const [reference, setReference] = useState("");
  const [err, setErr] = useState("");
  const [shortfall, setShortfall] = useState(false);
  const [saving, setSaving] = useState(false);
  // Staff's choice for the outstanding interest/penal interest currently
  // standing on the loan (see TopUpInput.settleInterest) — only relevant
  // when hasArrears; ignored server-side otherwise.
  const [settleMode, setSettleMode] = useState<"require" | "deduct">("require");
  // Reveals a "Record Payment" fallback in place of the raw error when the
  // backend bounces a "require" top-up for still-unpaid arrears (mirrors
  // ExtensionReviewModal.tsx's own needsPayment pattern).
  const [needsPayment, setNeedsPayment] = useState(false);

  const amt = +amount || 0;
  const balanced = Math.abs(remaining) < 0.01;

  function openAddOrnaments() {
    closeModal();
    openModal(
      <EditLoanModalContent
        loan={loan}
        onSaved={async () => {
          // EditLoanModalContent's onSaved carries no payload — re-fetch so
          // the reopened top-up modal sees the now-larger eligible amount,
          // matching what the customer originally asked for.
          const updated = await getLoan(loan.numericId);
          onSaved(updated);
          openModal(<TopUpLoanModalContent loan={updated} onSaved={onSaved} />);
        }}
      />,
      true
    );
  }

  async function save() {
    if (!amt || amt <= 0) { setErr("Please enter the top-up amount."); return; }
    if (!balanced) { setErr("The payment breakdown must add up to the amount."); return; }
    setSaving(true);
    setErr("");
    setShortfall(false);
    setNeedsPayment(false);
    try {
      const updated = await topUpLoan(loan.numericId, {
        amount: amt,
        cashAmount: split.cashAmount,
        upiAmount: split.upiAmount,
        bankTransferAmount: split.bankTransferAmount,
        chequeAmount: split.chequeAmount,
        reference: reference.trim() || undefined,
        settleInterest: hasArrears ? settleMode : undefined,
      });
      toast(
        settleMode === "deduct" && hasArrears
          ? `${fmt(amt)} topped up on loan ${loan.id} — ${fmt(arrears)} interest deducted from the payout`
          : `${fmt(amt)} topped up on loan ${loan.id}`
      );
      onSaved(updated);
      closeModal();
    } catch (e) {
      if (e instanceof ApiError && /headroom/i.test(e.message)) {
        setShortfall(true);
        setErr(e.message);
      } else if (e instanceof ApiError && e.status === 400 && /outstanding interest/i.test(e.message)) {
        // ErrTopUpNeedsPayment — settleMode is "require" and arrears still
        // stand. Reveal the Record Payment prompt instead of the raw error.
        setNeedsPayment(true);
        setErr("Outstanding interest/penal interest must be paid before this top-up can proceed — record a payment below, or switch to \"Deduct from payout\" above.");
      } else {
        setErr(e instanceof ApiError ? e.message : "Could not record the top-up — try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Top Up Loan — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="notice" style={{ marginBottom: 16, flexDirection: "column", alignItems: "stretch", gap: 4 }}>
          <div><Icon name="coin" /> Available headroom: <b>{fmt(headroom)}</b></div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Eligible {fmt(loan.eligibleLoanAmount)} − Outstanding {fmt(loan.outstanding)}</div>
        </div>
        {hasArrears && (
          <div className="notice" style={{ marginBottom: 16, flexDirection: "column", alignItems: "stretch", gap: 8 }}>
            <div>This loan has <b>{fmt(arrears)}</b> outstanding interest{(loan.outstandingPenalInterest ?? 0) > 0.01 ? " + penal interest" : ""}. How should it be handled?</div>
            <label className="ccheck">
              <input type="radio" name="settleMode" checked={settleMode === "require"} onChange={() => setSettleMode("require")} />
              <span className="mark" />
              <span>Customer pays it first, separately</span>
            </label>
            <label className="ccheck">
              <input type="radio" name="settleMode" checked={settleMode === "deduct"} onChange={() => setSettleMode("deduct")} />
              <span className="mark" />
              <span>Deduct it from this top-up's payout (less cash handed out)</span>
            </label>
          </div>
        )}
        <div className="frow">
          <div><label className="f">Top-up Amount (₹) *</label><input className="inp" type="number" min={1} max={headroom || undefined} placeholder="e.g. 5000" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        </div>
        <div className="frow" style={{ marginTop: 4 }}>
          <SplitPaymentInput totalAmount={amt} onChange={(s, r) => { setSplit(s); setRemaining(r); }} />
        </div>
        <div className="frow"><div><label className="f">Reference</label><input className="inp" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} /></div></div>
        {err && (
          <div className="notice" style={{ marginTop: 10 }}>
            {err}
            {shortfall && (
              <div style={{ marginTop: 8 }}>
                <a href="#" onClick={(e) => { e.preventDefault(); openAddOrnaments(); }}>Add ornaments to raise the eligible amount →</a>
              </div>
            )}
          </div>
        )}
        {needsPayment && (
          <div style={{ marginTop: 10 }}>
            <button
              className="btn ghost sm"
              onClick={() => openModal(
                <PaymentModalContent
                  loan={liveLoan}
                  onSaved={async () => {
                    setNeedsPayment(false);
                    setErr("");
                    setLiveLoan(await getLoan(loan.numericId));
                  }}
                />
              )}
            >
              <Icon name="coin" /> Record Payment
            </button>
          </div>
        )}
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" disabled={saving || !balanced} onClick={save}>{saving ? "Recording…" : "Top Up"}</button>
      </div>
    </>
  );
}
