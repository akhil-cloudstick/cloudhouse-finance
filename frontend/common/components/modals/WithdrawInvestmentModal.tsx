"use client";

import { useState } from "react";
import { useModal } from "@/common/components/Modal";
import { fmt } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { Select } from "@/common/components/ui/Select";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/common/components/ui/SplitPaymentInput";
import { withdrawFromInvestment, type BackendInvestment } from "@/modules/investments/services/investmentService";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

type WithdrawFrom = "Interest" | "Principal" | "Both";

const WITHDRAW_FROM_OPTIONS = [
  { value: "Interest", label: "Interest" },
  { value: "Principal", label: "Principal" },
  { value: "Both", label: "Principal and Interest" },
];

/* Withdraws from a Live-engine investment's Outstanding Principal and/or
 * Outstanding Interest — the "Withdraw From" selector only changes which of
 * the two amount inputs are shown; the backend's WithdrawInput always takes
 * both explicitly (either can be 0), which is exactly what this pair of
 * fields produces. See InvestmentTransaction's doc comment for why the
 * split is represented this way rather than one amount + an enum. */
export function WithdrawInvestmentModalContent({
  investment,
  onSaved,
}: {
  investment: BackendInvestment;
  onSaved: (updated: BackendInvestment) => void;
}) {
  const { closeModal } = useModal();
  const [from, setFrom] = useState<WithdrawFrom>("Interest");
  const [interestAmount, setInterestAmount] = useState("");
  const [principalAmount, setPrincipalAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayISO());
  const [reference, setReference] = useState("");
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [remaining, setRemaining] = useState(0);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const interestNum = from === "Principal" ? 0 : (+interestAmount || 0);
  const principalNum = from === "Interest" ? 0 : (+principalAmount || 0);
  const total = Math.round((interestNum + principalNum) * 100) / 100;
  const balanced = Math.abs(remaining) < 0.01;

  const outstandingInterest = investment.outstandingInterest;
  const outstandingPrincipal = investment.outstandingPrincipal;

  async function save() {
    if (total <= 0) { setErr("Enter an amount greater than zero."); return; }
    if (interestNum > outstandingInterest + 0.01) { setErr(`Interest amount exceeds the outstanding interest (${fmt(outstandingInterest)}).`); return; }
    if (principalNum > outstandingPrincipal + 0.01) { setErr(`Principal amount exceeds the outstanding principal (${fmt(outstandingPrincipal)}).`); return; }
    if (!balanced) { setErr("The payment breakdown must add up to the amount."); return; }
    setSaving(true);
    setErr("");
    try {
      const updated = await withdrawFromInvestment(investment.id, {
        interestAmount: interestNum,
        principalAmount: principalNum,
        occurredOn: occurredOn ? new Date(occurredOn).toISOString() : undefined,
        reference: reference.trim(),
        ...split,
      });
      onSaved(updated);
      closeModal();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not withdraw from this investment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Withdraw</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="notice" style={{ marginBottom: 16 }}>
          Outstanding Principal: <strong>{fmt(outstandingPrincipal)}</strong> · Outstanding Interest: <strong>{fmt(outstandingInterest)}</strong>
        </div>
        <div className="frow c2">
          <div><label className="f">Withdraw From *</label><Select options={WITHDRAW_FROM_OPTIONS} value={from} onChange={(v) => setFrom(v as WithdrawFrom)} /></div>
          <div><label className="f">Date *</label><DatePicker value={occurredOn} onChange={setOccurredOn} max={todayISO()} /></div>
        </div>
        <div className="frow c2">
          {from !== "Principal" && (
            <div><label className="f">Interest Amount *</label><input className="inp" type="number" min={0} step={0.01} max={outstandingInterest} placeholder="e.g. 1200" value={interestAmount} onChange={(e) => setInterestAmount(e.target.value)} /></div>
          )}
          {from !== "Interest" && (
            <div><label className="f">Principal Amount *</label><input className="inp" type="number" min={0} step={0.01} max={outstandingPrincipal} placeholder="e.g. 20000" value={principalAmount} onChange={(e) => setPrincipalAmount(e.target.value)} /></div>
          )}
        </div>
        <div className="frow">
          <div><label className="f">Reference</label><input className="inp" placeholder="Optional note" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
        </div>
        <div className="frow">
          <SplitPaymentInput totalAmount={total} onChange={(s, r) => { setSplit(s); setRemaining(r); }} />
        </div>
        {err && <div className="notice" style={{ marginTop: 10 }}>{err}</div>}
      </div>
      <div className="ft">
        <button className="btn plain" style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase" }} onClick={closeModal}>Cancel</button>
        <button className="btn" disabled={saving || total <= 0 || !balanced} onClick={save}>{saving ? "Withdrawing…" : "Withdraw"}</button>
      </div>
    </>
  );
}
