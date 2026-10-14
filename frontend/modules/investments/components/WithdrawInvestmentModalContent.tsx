"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { fmt } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { Select } from "@/common/components/ui/Select";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/common/components/SplitPaymentInput";
import { withdrawFromInvestment } from "@/modules/investments/services/investmentService";
import { type BackendInvestment } from "@/modules/investments/types/investment-types";
import { singleFlight } from "@/common/utils/singleFlight";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";

// Which field a server message is about, by its words (first match wins).
const SERVER_FIELDS: Record<string, RegExp> = {
  split: /payment|breakdown|bank|cheque|upi/i, date: /date/i, interest: /interest/i, principal: /principal/i,
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

type WithdrawFrom = "Interest" | "Principal" | "Both";

const WITHDRAW_FROM_OPTIONS = [
  { value: "Interest", label: "Interest" },
  { value: "Principal", label: "Principal" },
  { value: "Both", label: "Principal and Interest" },
];

type WithdrawInvestmentModalContentProps = {
  investment: BackendInvestment;
  onSaved: (updated: BackendInvestment) => void;
};

/* Withdraws from a Live-engine investment's Outstanding Principal and/or
 * Outstanding Interest — the "Withdraw From" selector only changes which of
 * the two amount inputs are shown; the backend's WithdrawInput always takes
 * both explicitly (either can be 0), which is exactly what this pair of
 * fields produces. See InvestmentTransaction's doc comment for why the
 * split is represented this way rather than one amount + an enum. */
export function WithdrawInvestmentModalContent({
  investment,
  onSaved,
}: WithdrawInvestmentModalContentProps) {
  const { closeModal } = useModal();
  const [from, setFrom] = useState<WithdrawFrom>("Interest");
  const [interestAmount, setInterestAmount] = useState("");
  const [principalAmount, setPrincipalAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayISO());
  const [reference, setReference] = useState("");
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [remaining, setRemaining] = useState(0);
  const [bankId, setBankId] = useState<number | undefined>(undefined);
  const [err, setErr] = useState("");
  // Validation messages, each shown under the field it is about; `err` keeps the ones that fit no field.
  const [fe, setFe] = useState<Record<string, string>>({});
  const fail = (field: string, msg: string) => { setErr(""); setFe({ [field]: msg }); };
  const [saving, setSaving] = useState(false);

  const interestNum = from === "Principal" ? 0 : (+interestAmount || 0);
  const principalNum = from === "Interest" ? 0 : (+principalAmount || 0);
  const total = Math.round((interestNum + principalNum) * 100) / 100;
  const balanced = Math.abs(remaining) < 0.01;

  const outstandingInterest = investment.outstandingInterest;
  const outstandingPrincipal = investment.outstandingPrincipal;

  async function save() { return singleFlight("modal:withdrawinvestment:save", async () => {
    if (total <= 0) { fail(from === "Principal" ? "principal" : "interest", "Enter an amount greater than zero."); return; }
    if (interestNum > outstandingInterest + 0.01) { fail("interest", `Interest amount exceeds the outstanding interest (${fmt(outstandingInterest)}).`); return; }
    if (principalNum > outstandingPrincipal + 0.01) { fail("principal", `Principal amount exceeds the outstanding principal (${fmt(outstandingPrincipal)}).`); return; }
    if (!balanced) { fail("split", "The payment breakdown must add up to the amount."); return; }
    setSaving(true);
    setErr("");
    setFe({});
    try {
      const updated = await withdrawFromInvestment(investment.id, {
        interestAmount: interestNum,
        principalAmount: principalNum,
        occurredOn: occurredOn ? new Date(occurredOn).toISOString() : undefined,
        reference: reference.trim(),
        ...split,
        bankId,
      });
      onSaved(updated);
      closeModal();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not withdraw from this investment.";
      const field = fieldForMessage(msg, SERVER_FIELDS);
      if (field) fail(field, msg); else setErr(msg);
    } finally {
      setSaving(false);
    }
  }); }

  return (
    <>
      <div className="hd"><h3>Withdraw</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="notice" style={{ marginBottom: 16 }}>
          Outstanding Principal: <strong>{fmt(outstandingPrincipal)}</strong> · Outstanding Interest: <strong>{fmt(outstandingInterest)}</strong>
        </div>
        <div className="frow c2">
          <div><label className="f">Withdraw From *</label><Select options={WITHDRAW_FROM_OPTIONS} value={from} onChange={(v) => setFrom(v as WithdrawFrom)} /></div>
          <div className={fe.date ? "has-err" : undefined}><label className="f">Date *</label><DatePicker value={occurredOn} onChange={setOccurredOn} max={todayISO()} /><FieldError msg={fe.date} /></div>
        </div>
        <div className="frow c2">
          {from !== "Principal" && (
            <div className={fe.interest ? "has-err" : undefined}><label className="f">Interest Amount *</label><input className="inp" type="number" min={0} step={0.01} max={outstandingInterest} placeholder="e.g. 1200" value={interestAmount} onChange={(e) => setInterestAmount(e.target.value)} /><FieldError msg={fe.interest} /></div>
          )}
          {from !== "Interest" && (
            <div className={fe.principal ? "has-err" : undefined}><label className="f">Principal Amount *</label><input className="inp" type="number" min={0} step={0.01} max={outstandingPrincipal} placeholder="e.g. 20000" value={principalAmount} onChange={(e) => setPrincipalAmount(e.target.value)} /><FieldError msg={fe.principal} /></div>
          )}
        </div>
        <div className="frow">
          <div><label className="f">Reference</label><input className="inp" placeholder="Optional note" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
        </div>
        <div className="frow">
          <div className={fe.split ? "has-err" : undefined}>
            <SplitPaymentInput totalAmount={total} onChange={(s, r, bid) => { setSplit(s); setRemaining(r); setBankId(bid); }} />
            <FieldError msg={fe.split} />
          </div>
        </div>
        {err && <div className="notice" style={{ marginTop: 10 }}>{err}</div>}
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" disabled={saving || total <= 0 || !balanced} onClick={save}>{saving ? "Withdrawing…" : "Withdraw"}</button>
      </div>
    </>
  );
}
