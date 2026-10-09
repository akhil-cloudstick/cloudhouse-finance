"use client";

import { useState } from "react";
import { useModal } from "@/product/components/Modal";
import { fmt } from "@/product/utils/format";
import { ApiError } from "@/product/services/httpClient";
import { DatePicker } from "@/product/components/ui/DatePicker";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/product/components/ui/SplitPaymentInput";
import { addCashToInvestment, type BackendInvestment } from "@/product/pages/investments/services/investmentService";
import { singleFlight } from "@/product/utils/singleFlight";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/* Deposits additional principal into a Live-engine investment — the
 * counterpart to Withdraw below. Settling interest against the OLD
 * principal before this deposit is applied is entirely a backend concern
 * (Service.AddCash's settle-then-mutate order); this modal only collects
 * the amount, date and payment-mode breakdown, same shape as
 * AddCashModal.tsx's cash-ledger deposit form. */
export function AddInvestmentCashModalContent({
  investment,
  onSaved,
}: {
  investment: BackendInvestment;
  onSaved: (updated: BackendInvestment) => void;
}) {
  const { closeModal } = useModal();
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayISO());
  const [reference, setReference] = useState("");
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [remaining, setRemaining] = useState(0);
  const [bankId, setBankId] = useState<number | undefined>(undefined);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const amountNum = +amount || 0;
  const balanced = Math.abs(remaining) < 0.01;

  async function save() { return singleFlight("modal:addinvestmentcash:save", async () => {
    if (amountNum <= 0) { setErr("Enter an amount greater than zero."); return; }
    if (!balanced) { setErr("The payment breakdown must add up to the amount."); return; }
    setSaving(true);
    setErr("");
    try {
      const updated = await addCashToInvestment(investment.id, {
        amount: amountNum,
        occurredOn: occurredOn ? new Date(occurredOn).toISOString() : undefined,
        reference: reference.trim(),
        ...split,
        bankId,
      });
      onSaved(updated);
      closeModal();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not add cash to this investment.");
    } finally {
      setSaving(false);
    }
  }); }

  return (
    <>
      <div className="hd"><h3>Add Cash</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="notice" style={{ marginBottom: 16 }}>
          Current Outstanding Principal: <strong>{fmt(investment.outstandingPrincipal)}</strong>
        </div>
        <div className="frow c2">
          <div><label className="f">Amount *</label><input className="inp" type="number" min={0} step={0.01} placeholder="e.g. 50000" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div><label className="f">Date *</label><DatePicker value={occurredOn} onChange={setOccurredOn} max={todayISO()} /></div>
        </div>
        <div className="frow">
          <div><label className="f">Reference</label><input className="inp" placeholder="Optional note" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
        </div>
        <div className="frow">
          <SplitPaymentInput totalAmount={amountNum} onChange={(s, r, bid) => { setSplit(s); setRemaining(r); setBankId(bid); }} />
        </div>
        {err && <div className="notice" style={{ marginTop: 10 }}>{err}</div>}
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" disabled={saving || amountNum <= 0 || !balanced} onClick={save}>{saving ? "Saving…" : "Add Cash"}</button>
      </div>
    </>
  );
}
