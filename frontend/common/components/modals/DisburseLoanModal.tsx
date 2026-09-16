"use client";

import { useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { ApiError } from "@/common/services/httpClient";
import { fmt } from "@/common/utils/format";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/common/components/ui/SplitPaymentInput";
import { approveLoan, type LoanView, type SanctionStage } from "@/modules/loans/services/loanService";

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
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const balanced = Math.abs(remaining) < 0.01;

  async function save() {
    if (!balanced) { setErr("The payment breakdown must add up to the principal amount."); return; }
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
      <div className="hd"><h3>Approve &amp; Disburse — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="notice" style={{ marginBottom: 16 }}>
          Approving this loan disburses <strong>{fmt(loan.principal)}</strong> to the customer.
        </div>
        <div className="frow">
          <SplitPaymentInput totalAmount={loan.principal} onChange={(s, r) => { setSplit(s); setRemaining(r); }} />
        </div>
        {err && <div className="notice" style={{ marginTop: 10 }}>{err}</div>}
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" disabled={saving || !balanced} onClick={save}>{saving ? "Approving…" : `Approve & Disburse ${fmt(loan.principal)}`}</button>
      </div>
    </>
  );
}
