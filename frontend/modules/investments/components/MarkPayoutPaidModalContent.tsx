"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { fmt } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/common/components/SplitPaymentInput";
import { markPayoutPaid } from "@/modules/investments/services/investmentService";
import { type BackendInvestmentPayout } from "@/modules/investments/types/investment-types";
import { singleFlight } from "@/common/utils/singleFlight";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";

type MarkPayoutPaidModalContentProps = {
  investmentId: number;
  payout: BackendInvestmentPayout;
  onSaved: (updated: BackendInvestmentPayout) => void;
};

// Which field a server message is about, by its words (first match wins).
const SERVER_FIELDS: Record<string, RegExp> = {
  split: /payment|breakdown|bank|cheque|upi/i,
};

/* Marking a scheduled interest/principal-return payout as paid is also the
 * moment that cash actually leaves the till (investment.CashRecorder,
 * called from Service.MarkPayoutPaid) — collects the split-mode breakdown
 * before confirming, same rationale as DisburseLoanModal.tsx for a gold
 * loan's sanction disbursement. */
export function MarkPayoutPaidModalContent({
  investmentId,
  payout,
  onSaved,
}: MarkPayoutPaidModalContentProps) {
  const { closeModal } = useModal();
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [remaining, setRemaining] = useState(0);
  const [bankId, setBankId] = useState<number | undefined>(undefined);
  const [err, setErr] = useState("");
  // Validation messages, each shown under the field it is about; `err` keeps the ones that fit no field.
  const [fe, setFe] = useState<Record<string, string>>({});
  const fail = (field: string, msg: string) => { setErr(""); setFe({ [field]: msg }); };
  const [saving, setSaving] = useState(false);
  const balanced = Math.abs(remaining) < 0.01;

  async function save() { return singleFlight("modal:markpayoutpaid:save", async () => {
    if (!balanced) { fail("split", "The payment breakdown must add up to the payout amount."); return; }
    setSaving(true);
    setErr("");
    setFe({});
    try {
      const updated = await markPayoutPaid(investmentId, payout.id, split, bankId);
      onSaved(updated);
      closeModal();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not record this payout.";
      const field = fieldForMessage(msg, SERVER_FIELDS);
      if (field) fail(field, msg); else setErr(msg);
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
          <div className={fe.split ? "has-err" : undefined}>
            <SplitPaymentInput totalAmount={payout.amount} onChange={(s, r, bid) => { setSplit(s); setRemaining(r); setBankId(bid); }} />
            <FieldError msg={fe.split} />
          </div>
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
