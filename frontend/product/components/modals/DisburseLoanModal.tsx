"use client";

import { useState } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { ApiError } from "@/product/services/httpClient";
import { fmt } from "@/product/utils/format";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/product/components/ui/SplitPaymentInput";
import { approveLoan, type LoanView, type SanctionStage } from "@/product/pages/loans/services/loanService";
import { useBalanceInHand } from "@/product/hooks/useBalanceInHand";

/* The FinalSanction stage's "Approve" action is also the moment the
 * principal actually leaves the till (see backend Service.Approve's
 * disbursing branch) — unlike the LoanOperator/BranchManager stages, which
 * just advance the sanction chain with no cash movement. This modal collects
 * the split-mode breakdown of that disbursement before confirming, instead
 * of the plain one-click Approve the earlier stages use. */
export function DisburseLoanModalContent({
  loan,
  stage,
  onSaved,
}: {
  loan: LoanView;
  stage: SanctionStage;
  onSaved: (updated: LoanView) => void;
}) {
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
        action: "Approved",
        cashAmount: split.cashAmount,
        upiAmount: split.upiAmount,
        bankTransferAmount: split.bankTransferAmount,
        chequeAmount: split.chequeAmount,
        bankId,
      });
      toast(`Approved — ${fmt(loan.principal)} disbursed to the customer`);
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
      <div className="hd" style={{ minHeight: 66 }}><h3>Approve &amp; Disburse — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="frow">
          <SplitPaymentInput totalAmount={loan.principal} onChange={(s, r, bid) => { setSplit(s); setRemaining(r); setBankId(bid); }} />
        </div>
        {balanceInHand !== null && (
          <p style={{ fontSize: 12.5, marginTop: 8, color: insufficient ? "var(--red)" : "var(--muted)" }}>
            Balance in hand: <strong>{fmt(balanceInHand)}</strong>
            {insufficient && " — not enough to disburse this loan. Add cash before approving."}
          </p>
        )}
        {err && <div className="notice" style={{ marginTop: 10 }}>{err}</div>}
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" disabled={saving || !balanced || insufficient} onClick={save}>{saving ? "Approving…" : `Approve & Disburse ${fmt(loan.principal)}`}</button>
      </div>
    </>
  );
}
