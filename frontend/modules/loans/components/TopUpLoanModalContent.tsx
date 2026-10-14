"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { fmt } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { useApprovalWorkflow, useAuth } from "@/common/providers/AuthProvider";
import { isFlowOff } from "@/common/services/approvalWorkflowService";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/common/components/SplitPaymentInput";
import { topUpLoan, getLoan } from "@/modules/loans/services/loanService";
import { type LoanView } from "@/modules/loans/types/loan-types";
import { EditLoanModalContent } from "@/modules/loans/components/EditLoanModalContent";
import { PaymentModalContent } from "@/common/components/modals/PaymentModalContent";
import { singleFlight } from "@/common/utils/singleFlight";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";

type TopUpLoanModalContentProps = { loan: LoanView; onSaved: (updated: LoanView) => void; initialAmount?: string; initialReference?: string };

/* Draws additional cash against an already-Active loan's spare eligible
 * value, without closing/reopening it — a single-step flow (no multi-stage
 * sanction chain). Shows current headroom (eligibleLoanAmount -
 * outstanding); if the requested amount exceeds it, the backend rejects
 * with ErrTopUpShortfall and this modal chains straight into the existing
 * "Edit Loan" ornament-add flow, then reopens itself once ornaments are
 * saved so the new (larger) headroom is visible without a second click.
 *
 * When the business has the loan_topup approval flow switched on, the same
 * form submits the top-up INTO that chain instead: nothing is paid out yet,
 * the loan comes back unchanged, and LoanDetail shows the pending top-up
 * with its stage tracker until the final stage approves (and pays) it.
 *
 * When interest is outstanding and staff pick "Customer pays it first", Top
 * Up redirects to Record Payment preset to "Interest only" instead of
 * letting the backend bounce it; once that payment is confirmed this modal
 * reopens on the refreshed loan with the entered amount/reference kept
 * (initialAmount/initialReference). The modal host holds one modal at a
 * time, so the reopen has to be explicit. */
export function TopUpLoanModalContent({ loan, onSaved, initialAmount = "", initialReference = "" }: TopUpLoanModalContentProps) {
  const { openModal, closeModal } = useModal();
  const toast = useToast();
  const { config: workflow } = useApprovalWorkflow();
  // Topping up is its own grant; the add-ornaments and pay-interest
  // shortcuts below are loan edits/payments, so they need "can update loan".
  const canUpdateLoans = useAuth().can("Loan_Management", "can_update_loan");
  const needsApproval = !isFlowOff(workflow, "loan_topup");
  const headroom = Math.max(0, loan.eligibleLoanAmount - loan.outstanding);
  const arrears = (loan.outstandingInterest ?? 0) + (loan.outstandingPenalInterest ?? 0);
  const hasArrears = arrears > 0.01;

  const [amount, setAmount] = useState(initialAmount);
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [remaining, setRemaining] = useState(0);
  const [bankId, setBankId] = useState<number | undefined>(undefined);
  const [reference, setReference] = useState(initialReference);
  const [err, setErr] = useState("");
  const [fe, setFe] = useState<Record<string, string>>({});
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

  // Redirects to Record Payment on "Interest only" (prefilled with the
  // interest + penal owed), then reopens this modal on the refreshed loan.
  function openPayInterest() {
    openModal(
      <PaymentModalContent
        loan={loan}
        initialMode="Interest"
        onSaved={async () => {
          const updated = await getLoan(loan.numericId);
          onSaved(updated);
          openModal(<TopUpLoanModalContent loan={updated} onSaved={onSaved} initialAmount={amount} initialReference={reference} />);
        }}
      />,
      true
    );
  }

  const fail = (field: string, msg: string) => { setErr(""); setFe({ [field]: msg }); };

  async function save() { return singleFlight("modal:topuploan:save", async () => {
    setErr(""); setFe({});
    if (!amt || amt <= 0) { fail("amount", "Please enter the top-up amount."); return; }
    if (!balanced) { fail("payments", "The payment breakdown must add up to the amount."); return; }
    if (hasArrears && settleMode === "require") {
      if (canUpdateLoans) openPayInterest();
      else { setFe({}); setErr("Interest must be paid before this top-up. Ask someone who can record loan payments."); }
      return;
    }
    setSaving(true);
    setShortfall(false);
    setNeedsPayment(false);
    try {
      const updated = await topUpLoan(loan.numericId, {
        amount: amt,
        cashAmount: split.cashAmount,
        upiAmount: split.upiAmount,
        bankTransferAmount: split.bankTransferAmount,
        chequeAmount: split.chequeAmount,
        bankId,
        reference: reference.trim() || undefined,
        settleInterest: hasArrears ? settleMode : undefined,
      });
      toast(
        needsApproval
          ? "Top-up submitted for approval"
          : settleMode === "deduct" && hasArrears
            ? `${fmt(amt)} topped up on loan ${loan.id} — ${fmt(arrears)} interest deducted from the payout`
            : `${fmt(amt)} topped up on loan ${loan.id}`
      );
      onSaved(updated);
      closeModal();
    } catch (e) {
      if (e instanceof ApiError && /headroom/i.test(e.message)) {
        setShortfall(true);
        fail("amount", e.message);
      } else if (e instanceof ApiError && e.status === 400 && /outstanding interest/i.test(e.message)) {
        // ErrTopUpNeedsPayment — settleMode is "require" and arrears still
        // stand. Reveal the Record Payment prompt instead of the raw error.
        setNeedsPayment(true);
        setFe({});
        setErr("Outstanding interest/penal interest must be paid before this top-up can proceed — record a payment below, or switch to \"Deduct from payout\" above.");
      } else {
        const msg = e instanceof ApiError ? e.message : "Could not record the top-up — try again.";
        const field = fieldForMessage(msg, { reference: /reference/i, payments: /bank|breakdown/i });
        if (field) fail(field, msg); else { setFe({}); setErr(msg); }
      }
    } finally {
      setSaving(false);
    }
  }); }

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
          <div className={fe.amount ? "has-err" : undefined}><label className="f">Top-up Amount (₹) *</label><input className="inp" type="number" min={1} max={headroom || undefined} placeholder="e.g. 5000" value={amount} onChange={(e) => { setAmount(e.target.value); setFe((cur) => ({ ...cur, amount: "" })); }} /><FieldError msg={fe.amount} />
            {fe.amount && shortfall && canUpdateLoans && (
              <div style={{ marginTop: 4, fontSize: 12 }}>
                <a href="#" onClick={(e) => { e.preventDefault(); openAddOrnaments(); }}>Add ornaments to raise the eligible amount →</a>
              </div>
            )}
          </div>
        </div>
        <div className={fe.payments ? "has-err" : undefined}>
          <div className="frow" style={{ marginTop: 4 }}>
            <SplitPaymentInput totalAmount={amt} onChange={(s, r, bid) => { setSplit(s); setRemaining(r); setBankId(bid); setFe((cur) => (cur.payments ? { ...cur, payments: "" } : cur)); }} />
          </div>
          <FieldError msg={fe.payments} />
        </div>
        <div className="frow"><div className={fe.reference ? "has-err" : undefined}><label className="f">Reference</label><input className="inp" value={reference} onChange={(e) => { setReference(e.target.value); setFe((cur) => ({ ...cur, reference: "" })); }} maxLength={80} /><FieldError msg={fe.reference} /></div></div>
        {err && <div className="notice" style={{ marginTop: 10 }}>{err}</div>}
        {needsPayment && canUpdateLoans && (
          <div style={{ marginTop: 10 }}>
            <button className="btn ghost sm" onClick={openPayInterest}>
              <Icon name="coin" /> Record Payment
            </button>
          </div>
        )}
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" disabled={saving || !balanced} onClick={save}>{saving ? (needsApproval ? "Submitting…" : "Recording…") : hasArrears && settleMode === "require" ? "Pay Interest First" : needsApproval ? "Submit for Approval" : "Top Up"}</button>
      </div>
    </>
  );
}
