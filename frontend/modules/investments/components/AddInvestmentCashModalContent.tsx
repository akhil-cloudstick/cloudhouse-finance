"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { fmt } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/common/components/SplitPaymentInput";
import { addCashToInvestment } from "@/modules/investments/services/investmentService";
import { type BackendInvestment } from "@/modules/investments/types/investment-types";
import { singleFlight } from "@/common/utils/singleFlight";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";

// Which field a server message is about, by its words (first match wins).
const SERVER_FIELDS: Record<string, RegExp> = {
  split: /payment|breakdown|bank|cheque|upi/i, date: /date/i, amount: /amount/i,
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

type AddInvestmentCashModalContentProps = {
  investment: BackendInvestment;
  onSaved: (updated: BackendInvestment) => void;
};

/* Deposits additional principal into a Live-engine investment — the
 * counterpart to Withdraw below. Settling interest against the OLD
 * principal before this deposit is applied is entirely a backend concern
 * (Service.AddCash's settle-then-mutate order); this modal only collects
 * the amount, date and payment-mode breakdown, same shape as
 * AddCashModal.tsx's cash-ledger deposit form. */
export function AddInvestmentCashModalContent({
  investment,
  onSaved,
}: AddInvestmentCashModalContentProps) {
  const { closeModal } = useModal();
  const [amount, setAmount] = useState("");
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

  const amountNum = +amount || 0;
  const balanced = Math.abs(remaining) < 0.01;

  async function save() { return singleFlight("modal:addinvestmentcash:save", async () => {
    if (amountNum <= 0) { fail("amount", "Enter an amount greater than zero."); return; }
    if (!balanced) { fail("split", "The payment breakdown must add up to the amount."); return; }
    setSaving(true);
    setErr("");
    setFe({});
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
      const msg = e instanceof ApiError ? e.message : "Could not add cash to this investment.";
      const field = fieldForMessage(msg, SERVER_FIELDS);
      if (field) fail(field, msg); else setErr(msg);
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
          <div className={fe.amount ? "has-err" : undefined}><label className="f">Amount *</label><input className="inp" type="number" min={0} step={0.01} placeholder="e.g. 50000" value={amount} onChange={(e) => setAmount(e.target.value)} /><FieldError msg={fe.amount} /></div>
          <div className={fe.date ? "has-err" : undefined}><label className="f">Date *</label><DatePicker value={occurredOn} onChange={setOccurredOn} max={todayISO()} /><FieldError msg={fe.date} /></div>
        </div>
        <div className="frow">
          <div><label className="f">Reference</label><input className="inp" placeholder="Optional note" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
        </div>
        <div className="frow">
          <div className={fe.split ? "has-err" : undefined}>
            <SplitPaymentInput totalAmount={amountNum} onChange={(s, r, bid) => { setSplit(s); setRemaining(r); setBankId(bid); }} />
            <FieldError msg={fe.split} />
          </div>
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
