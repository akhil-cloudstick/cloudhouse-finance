"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { ApiError } from "@/common/services/httpClient";
import { fmt } from "@/common/utils/format";
import {
  previewRenewal,
  renewPersonalLoan,
  type BackendPersonalLoan,
  type Frequency,
  type InterestType,
  type RenewalPreview,
} from "@/modules/personal-loans/services/personalLoanService";

/* "Renew Loan" — closes `loan` and opens a new loan in its place: the old
 * loan's outstanding balance plus the new loan's own interest are deducted
 * from the new principal before any cash changes hands, but the new loan's
 * repayment obligation is the FULL new principal (see
 * backend/internal/personalloan/service.go's RenewLoan doc comment). The
 * preview is re-fetched (debounced) as the form changes so staff sees the
 * payout — or a shortfall warning — before committing. */
export function RenewLoanModalContent({ loan, onSaved }: { loan: BackendPersonalLoan; onSaved: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();

  const [principal, setPrincipal] = useState(String(loan.principalAmount));
  const [interestType, setInterestType] = useState<InterestType>(loan.interestType);
  const [interestValue, setInterestValue] = useState(String(loan.interestValue));
  const [frequency, setFrequency] = useState<Frequency>(loan.frequency);
  const [tenureCount, setTenureCount] = useState(String(loan.tenureCount));
  const [preview, setPreview] = useState<RenewalPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const principalNum = +principal || 0;
  const interestValueNum = +interestValue || 0;

  useEffect(() => {
    if (!principalNum) { setPreview(null); return; }
    let cancelled = false;
    const handle = setTimeout(() => {
      previewRenewal(loan.id, { principalAmount: principalNum, interestType, interestValue: interestValueNum, frequency, tenureCount: +tenureCount || 1 })
        .then((p) => { if (!cancelled) { setPreview(p); setPreviewError(""); } })
        .catch((e) => { if (!cancelled) { setPreview(null); setPreviewError(e instanceof ApiError ? e.message : "Could not compute preview."); } });
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [loan.id, principalNum, interestType, interestValueNum, frequency, tenureCount]);

  async function save() {
    const tenureNum = +tenureCount || 0;
    if (!principalNum || principalNum <= 0) { setErr("Please enter the new principal amount."); return; }
    if (!tenureNum || tenureNum <= 0) { setErr("Please enter the number of installments."); return; }
    setSaving(true);
    setErr("");
    try {
      await renewPersonalLoan(loan.id, { principalAmount: principalNum, interestType, interestValue: interestValueNum, frequency, tenureCount: tenureNum });
      toast(`${loan.loanNumber} renewed — new loan created`);
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not renew the loan — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Renew Loan — {loan.loanNumber}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="notice" style={{ marginBottom: 16 }}>Current outstanding balance: <strong>{fmt(loan.outstandingAmount)}</strong></div>
        <div className="frow c2">
          <div><label className="f">New Principal Amount (₹) *</label><input className="inp" type="number" min={1} value={principal} onChange={(e) => setPrincipal(e.target.value)} /></div>
          <div><label className="f">Number of Installments *</label><input className="inp" type="number" min={1} value={tenureCount} onChange={(e) => setTenureCount(e.target.value)} /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">Interest Type *</label>
            <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
              <label className="cradio" style={{ fontSize: 13, alignItems: "center" }}>
                <input type="radio" name="renewInterestType" checked={interestType === "Flat"} onChange={() => setInterestType("Flat")} />
                <span className="mark" /><span>Flat (₹)</span>
              </label>
              <label className="cradio" style={{ fontSize: 13, alignItems: "center" }}>
                <input type="radio" name="renewInterestType" checked={interestType === "Percentage"} onChange={() => setInterestType("Percentage")} />
                <span className="mark" /><span>Percentage (%)</span>
              </label>
            </div>
          </div>
          <div><label className="f">Interest Value *</label><input className="inp" type="number" min={0} step={0.01} value={interestValue} onChange={(e) => setInterestValue(e.target.value)} /></div>
        </div>
        <div className="frow"><div><label className="f">Collection Frequency *</label>
          <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
            {(["Daily", "Weekly", "Monthly"] as Frequency[]).map((f) => (
              <label key={f} className="cradio" style={{ fontSize: 13, alignItems: "center" }}>
                <input type="radio" name="renewFrequency" checked={frequency === f} onChange={() => setFrequency(f)} />
                <span className="mark" /><span>{f}</span>
              </label>
            ))}
          </div>
        </div></div>

        {previewError && <div className="notice" style={{ marginTop: 10 }}>{previewError}</div>}
        {preview && (
          <div className="notice" style={{ marginTop: 10 }}>
            <div>Rollover (old outstanding): <strong>{fmt(preview.rollover)}</strong></div>
            <div>New interest: <strong>{fmt(preview.interestAmount)}</strong></div>
            <div>Cash paid to customer: <strong>{fmt(preview.disbursedAmount)}</strong></div>
            <div>New repayment obligation: <strong>{fmt(principalNum)}</strong></div>
            {preview.shortfall && <div style={{ color: "var(--red, #c21725)", marginTop: 6 }}>⚠ New principal is not enough to cover the outstanding balance and interest.</div>}
          </div>
        )}
        {err && <div className="notice" style={{ marginTop: 10 }}>{err}</div>}
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" disabled={saving || !!preview?.shortfall} onClick={save}>{saving ? "Renewing…" : "Confirm Renewal"}</button>
      </div>
    </>
  );
}
