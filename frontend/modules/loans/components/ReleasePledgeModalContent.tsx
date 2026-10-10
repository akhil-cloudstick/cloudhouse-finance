"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { ApiError } from "@/common/services/httpClient";
import { fmt } from "@/common/utils/format";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/common/components/SplitPaymentInput";
import { singleFlight } from "@/common/utils/singleFlight";

export type ReleasePayment = SplitAmounts & { bankId?: number };

type ReleasePledgeModalContentProps = {
  bankName: string;
  amount: number;
  cashTreatment: string;
  onConfirm: (payment: ReleasePayment | undefined) => Promise<void>;
};

/* Confirms releasing gold from a bank pledge. A "CashIn" pledge pays the
 * pledged amount back to the bank, so staff pick how it is given (Cash / UPI /
 * Bank Transfer / Cheque, plus the branch bank account a non-cash share leaves
 * from). A "RecordOnly" pledge moved no money, so there is nothing to pick. */
export function ReleasePledgeModalContent({
  bankName,
  amount,
  cashTreatment,
  onConfirm,
}: ReleasePledgeModalContentProps) {
  const { closeModal } = useModal();
  const cashIn = cashTreatment === "CashIn";
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [remaining, setRemaining] = useState(0);
  const [bankId, setBankId] = useState<number | undefined>(undefined);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const balanced = !cashIn || Math.abs(remaining) < 0.01;

  async function save() { return singleFlight("modal:releasepledge:save", async () => {
    if (!balanced) { setErr("The payment breakdown must add up to the pledged amount."); return; }
    setSaving(true);
    setErr("");
    try {
      await onConfirm(cashIn ? { ...split, bankId } : undefined);
      closeModal();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not release the pledge — try again.");
    } finally {
      setSaving(false);
    }
  }); }

  return (
    <>
      <div className="hd"><h3>Release Bank Pledge</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <p style={{ fontSize: 13.5, marginBottom: 12 }}>
          Release the gold pledged to <strong>{bankName}</strong> for <strong>{fmt(amount)}</strong>?
          {cashIn ? " Choose how the amount is paid back to the bank." : " No cash movement will be created — this pledge was recorded only."}
        </p>
        {cashIn && (
          <div className="frow">
            <SplitPaymentInput totalAmount={amount} onChange={(s, r, bid) => { setSplit(s); setRemaining(r); setBankId(bid); }} />
          </div>
        )}
        {err && <div className="notice" style={{ marginTop: 10 }}>{err}</div>}
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" disabled={saving || !balanced} onClick={save}>{saving ? "Releasing…" : "Release"}</button>
      </div>
    </>
  );
}
