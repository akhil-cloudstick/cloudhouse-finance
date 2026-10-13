"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { ApiError } from "@/common/services/httpClient";
import { fmt } from "@/common/utils/format";
import { previewRenewal, renewPersonalLoan } from "@/modules/personal-loans/services/personalLoanService";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/common/components/SplitPaymentInput";
import { type BackendPersonalLoan, type Frequency, type InterestType, type RenewalPreview } from "@/modules/personal-loans/types/personal-loan-types";

type RenewLoanModalContentProps = { loan: BackendPersonalLoan; onSaved: () => void };

/* "Renew Loan" — closes `loan` and opens a new loan in its place: the old
 * loan's outstanding balance plus the new loan's own interest are deducted
 * from the new principal before any cash changes hands, but the new loan's
 * repayment obligation is the FULL new principal (see
 * backend/internal/personalloan/service.go's RenewLoan doc comment). The
 * preview is re-fetched (debounced) as the form changes so staff sees the
 * payout — or a shortfall warning — before committing. */
export function RenewLoanModalContent({ loan, onSaved }: RenewLoanModalContentProps) {
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
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [remaining, setRemaining] = useState(0);
  const [bankId, setBankId] = useState<number | undefined>(undefined);

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
    const payout = preview?.disbursedAmount ?? 0;
    if (payout > 0 && Math.abs(remaining) >= 0.01) { setErr("The payment breakdown must add up to the cash paid to the customer."); return; }
    if (payout > 0 && split.upiAmount + split.bankTransferAmount > 0 && !bankId) { setErr("Pick the bank the payout was made from."); return; }
    setSaving(true);
    setErr("");
    try {
      await renewPersonalLoan(loan.id, {
        principalAmount: principalNum, interestType, interestValue: interestValueNum, frequency, tenureCount: tenureNum,
        ...(payout > 0 ? { cashAmount: split.cashAmount, upiAmount: split.upiAmount, bankTransferAmount: split.bankTransferAmount, chequeAmount: split.chequeAmount, bankId } : {}),
      });
      toast(`${loan.loanNumber} renewed — new loan created`);
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not renew the loan — try again.");
    } finally {
      setSaving(false);
    }
  }

  const installmentAmount = +tenureCount > 0 && principalNum > 0 ? Math.round((principalNum / +tenureCount) * 100) / 100 : 0;
  const v = (n: number | undefined) => (preview && n !== undefined ? fmt(n) : "—");

  return (
    <>
      <div className="hd"><h3>Renew Loan — {loan.loanNumber}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll pl-modal">
        <div className="notice" style={{ marginBottom: 16 }}>Current outstanding balance: <strong>{fmt(loan.outstandingAmount)}</strong></div>
        <div className="pl-sec-h">Loan terms</div>
        <div className="frow c2">
          <div><label className="f">New Principal Amount (₹) *</label><input className="inp" type="number" min={1} placeholder="e.g. 5000" value={principal} onChange={(e) => setPrincipal(e.target.value)} /></div>
          <div><label className="f">Number of Installments *</label><input className="inp" type="number" min={1} placeholder="e.g. 50" value={tenureCount} onChange={(e) => setTenureCount(e.target.value)} /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">Interest Type *</label>
            <div className="pl-seg" role="radiogroup">
              {([["Flat", "Flat ₹"], ["Percentage", "Percent %"]] as [InterestType, string][]).map(([val, label]) => (
                <button key={val} type="button" role="radio" aria-checked={interestType === val}
                  className={interestType === val ? "on" : ""} onClick={() => setInterestType(val)}>{label}</button>
              ))}
            </div>
          </div>
          <div><label className="f">Interest Value *</label><input className="inp" type="number" min={0} step={0.01} placeholder={interestType === "Flat" ? "e.g. 100" : "e.g. 2"} value={interestValue} onChange={(e) => setInterestValue(e.target.value)} /></div>
        </div>
        <div className="frow"><div><label className="f">Collection Frequency *</label>
          <div className="pl-seg" role="radiogroup">
            {(["Daily", "Weekly", "Monthly"] as Frequency[]).map((f) => (
              <button key={f} type="button" role="radio" aria-checked={frequency === f}
                className={frequency === f ? "on" : ""} onClick={() => setFrequency(f)}>{f}</button>
            ))}
          </div>
        </div></div>

        {preview && preview.disbursedAmount > 0 && (
          <>
            <div className="pl-sec-h">Disbursement method</div>
            <div className="frow">
              <SplitPaymentInput totalAmount={preview.disbursedAmount} onChange={(s, r, bid) => { setSplit(s); setRemaining(r); setBankId(bid); }} />
            </div>
          </>
        )}

        {/* Live preview — dashes until the backend preview comes back. */}
        <div className="pl-sum">
          <div><span>Rollover</span><b>{v(preview?.rollover)}</b></div>
          <div><span>New interest</span><b>{v(preview?.interestAmount)}</b></div>
          <div><span>Customer gets</span><b>{v(preview?.disbursedAmount)}</b></div>
          <div><span>Per installment</span><b>{installmentAmount > 0 ? fmt(installmentAmount) : "—"}</b>{installmentAmount > 0 && <small>/ {frequency.toLowerCase()}</small>}</div>
        </div>
        {preview?.shortfall && <div className="notice" style={{ marginTop: 10, color: "var(--red, #c21725)" }}>⚠ New principal is not enough to cover the outstanding balance and interest.</div>}
        {previewError && <div className="notice" style={{ marginTop: 10 }}>{previewError}</div>}
        {err && <div className="notice" style={{ marginTop: 10 }}>{err}</div>}
      </div>
      <div className="ft">
        <button className="btn plain" style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase" }} onClick={closeModal}>Cancel</button>
        <button className="btn" disabled={saving || !!preview?.shortfall} onClick={save}>{saving ? "Renewing…" : "Confirm Renewal"}</button>
      </div>
    </>
  );
}
