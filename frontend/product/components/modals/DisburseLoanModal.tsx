"use client";

import { useState } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { ApiError } from "@/product/services/httpClient";
import { fmt } from "@/product/utils/format";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/product/components/ui/SplitPaymentInput";
import { approveLoan, type LoanView } from "@/product/pages/loans/services/loanService";
import { useBalanceInHand } from "@/product/hooks/useBalanceInHand";

/* The FINAL enabled sanction stage's affirmative action is also the moment
 * the principal actually leaves the till (see backend Service.Approve's
 * disbursing branch) — unlike the earlier stages, which just advance the
 * sanction chain with no cash movement. Which stage is final is per-business
 * configuration (flow "loan_sanction"): FinalSanction by default, but it can
 * be the Branch Manager's Approve or even the Loan Operator's Verify. This
 * modal collects the split-mode breakdown of that disbursement before
 * confirming, instead of the plain one-click Approve/Verify the earlier
 * stages use. */
export function DisburseLoanModalContent({
  loan,
  stage,
  onSaved,
}: {
  loan: LoanView;
  // The sanction stage KEY being cleared — whichever one is final.
  stage: string;
  onSaved: (updated: LoanView) => void;
}) {
  // "Verified" is the LoanOperator stage's own action (backend: only valid
  // there); every other stage approves.
  const isVerify = stage === "LoanOperator";
  const actionLabel = isVerify ? "Verify & Disburse" : "Approve & Disburse";
  const { closeModal } = useModal();
  const toast = useToast();
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [remaining, setRemaining] = useState(0);
  const [bankId, setBankId] = useState<number | undefined>(undefined);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const balanced = Math.abs(remaining) < 0.01;
  // Disbursement is blocked until the branch has enough balance in hand.
  const balanceInHand = useBalanceInHand(loan.branchId);
  const insufficient = balanceInHand !== null && loan.principal > balanceInHand + 0.005;

  async function save() {
    if (!balanced) { setErr("The payment breakdown must add up to the principal amount."); return; }
    if (insufficient) { setErr("Insufficient balance in hand to disburse this loan."); return; }
    setSaving(true);
    setErr("");
    try {
      const updated = await approveLoan(loan.numericId, {
        stage,
        action: isVerify ? "Verified" : "Approved",
        cashAmount: split.cashAmount,
        upiAmount: split.upiAmount,
        bankTransferAmount: split.bankTransferAmount,
        chequeAmount: split.chequeAmount,
        bankId,
      });
      toast(`${isVerify ? "Verified" : "Approved"} — ${fmt(loan.principal)} disbursed to the customer`);
      onSaved(updated);
      closeModal();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not record the decision — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd" style={{ minHeight: 66 }}><h3>{actionLabel} — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="frow">
          <SplitPaymentInput totalAmount={loan.principal} onChange={(s, r, bid) => { setSplit(s); setRemaining(r); setBankId(bid); }} />
        </div>
        {balanceInHand !== null && (
          <p style={{ fontSize: 12.5, marginTop: 8, color: insufficient ? "var(--red)" : "var(--muted)" }}>
            Balance in hand: <strong>{fmt(balanceInHand)}</strong>
            {insufficient && " — add cash to disburse."}
          </p>
        )}
        {err && <div className="notice" style={{ marginTop: 10 }}>{err}</div>}
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" disabled={saving || !balanced || insufficient} onClick={save}>{saving ? (isVerify ? "Verifying…" : "Approving…") : `${actionLabel} ${fmt(loan.principal)}`}</button>
      </div>
    </>
  );
}
