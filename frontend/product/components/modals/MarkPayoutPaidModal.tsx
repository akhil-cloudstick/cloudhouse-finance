"use client";

import { useState } from "react";
import { useModal } from "@/product/components/Modal";
import { fmt } from "@/product/utils/format";
import { ApiError } from "@/product/services/httpClient";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/product/components/ui/SplitPaymentInput";
import { markPayoutPaid, type BackendInvestmentPayout } from "@/product/pages/investments/services/investmentService";
import { singleFlight } from "@/product/utils/singleFlight";

/* Marking a scheduled interest/principal-return payout as paid is also the
 * moment that cash actually leaves the till (investment.CashRecorder,
 * called from Service.MarkPayoutPaid) — collects the split-mode breakdown
 * before confirming, same rationale as DisburseLoanModal.tsx for a gold
 * loan's sanction disbursement. */
export function MarkPayoutPaidModalContent({
  investmentId,
  payout,
  onSaved,
}: {
  investmentId: number;
  payout: BackendInvestmentPayout;
  onSaved: (updated: BackendInvestmentPayout) => void;
}) {
  const { closeModal } = useModal();
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [remaining, setRemaining] = useState(0);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const balanced = Math.abs(remaining) < 0.01;

  async function save() { return singleFlight("modal:markpayoutpaid:save", async () => {
    if (!balanced) { setErr("The payment breakdown must add up to the payout amount."); return; }
    setSaving(true);
    setErr("");
    try {
      const updated = await markPayoutPaid(investmentId, payout.id, split);
      onSaved(updated);
      closeModal();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not record this payout.");
    } finally {
      setSaving(false);
    }
  }); }

  return (
    <>
      <div className="hd"><h3>Mark Payout Paid</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="notice" style={{ marginBottom: 16 }}>
          {payout.isPrincipalReturn ? "Principal return" : "Interest payout"} of <strong>{fmt(payout.amount)}</strong>
        </div>
        <div className="frow">
          <SplitPaymentInput totalAmount={payout.amount} onChange={(s, r) => { setSplit(s); setRemaining(r); }} />
        </div>
        {err && <div className="notice" style={{ marginTop: 10 }}>{err}</div>}
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" disabled={saving || !balanced} onClick={save}>{saving ? "Recording…" : "Mark Paid"}</button>
      </div>
    </>
  );
}
