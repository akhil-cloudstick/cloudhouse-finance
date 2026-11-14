"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { fmt, roundRupee } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { Select } from "@/common/components/ui/Select";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/common/components/SplitPaymentInput";
import { withdrawFromInvestment } from "@/modules/investments/services/investmentService";
import { type BackendInvestment } from "@/modules/investments/types/investment-types";
import { singleFlight } from "@/common/utils/singleFlight";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";

const SERVER_FIELDS: Record<string, RegExp> = { split: /payment|breakdown|bank|cheque|upi/i, amount: /amount|principal|exceed/i };

type WithdrawFixedModalContentProps = { investment: BackendInvestment; onSaved: () => void };

/* Withdraws principal from a fixed-payout investment at any time. Part of it is paid out now and the remaining
 * payouts are reduced to match what is left; the whole of it closes the investment, paying the interest earned so
 * far with it (see backend withdrawScheduled). */
export function WithdrawFixedModalContent({ investment, onSaved }: WithdrawFixedModalContentProps) {
  const { closeModal } = useModal();
  const held = roundRupee(Math.max(0, investment.principalAmount - (investment.principalReturned ?? 0)));
  const interestOwed = roundRupee(investment.settlementInterest ?? 0);
  // Partial: any amount up to what is held. Full: everything, which closes the investment.
  const [kind, setKind] = useState<"Partial" | "Full">("Partial");
  const [typed, setTyped] = useState("");
  const amount = kind === "Full" ? String(held) : typed;
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [remaining, setRemaining] = useState(0);
  const [bankId, setBankId] = useState<number | undefined>(undefined);
  const [err, setErr] = useState("");
  const [fe, setFe] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const amountNum = +amount || 0;
  const full = kind === "Full" || (amountNum > 0 && amountNum >= held - 0.01);
  // taking everything closes the investment, which pays the interest earned so far as well
  const total = roundRupee(full ? held + interestOwed : amountNum);
  const balanced = Math.abs(remaining) < 0.01;

  async function save() { return singleFlight("modal:withdrawfixed:save", async () => {
    const errors: Record<string, string> = {};
    if (!(amountNum > 0)) errors["amount"] = "Enter an amount greater than zero.";
    else if (amountNum > held + 0.01) errors["amount"] = `Amount exceeds the principal held (${fmt(held)}).`;
    if (!balanced) errors["split"] = "The payment breakdown must add up to the amount.";
    if (Object.keys(errors).length) { setErr(""); setFe(errors); return; }
    setSaving(true);
    setErr("");
    setFe({});
    try {
      await withdrawFromInvestment(investment.id, { interestAmount: 0, principalAmount: full ? held : amountNum, ...split, bankId });
      onSaved();
      closeModal();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not withdraw from this investment.";
      const field = fieldForMessage(msg, SERVER_FIELDS);
      if (field) { setErr(""); setFe({ [field]: msg }); } else setErr(msg);
    } finally {
      setSaving(false);
    }
  }); }

  return (
    <>
      <div className="hd"><h3>Withdraw — {investment.investmentNumber}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className={fe.amount ? "has-err" : undefined}>
          <label className="f">Amount to withdraw (₹) *</label>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input className="inp" type="number" min={0} step={0.01} max={held} placeholder={`up to ${fmt(held)}`} value={amount} disabled={kind === "Full"} onChange={(e) => setTyped(e.target.value)} />
            <div style={{ flex: "0 0 150px" }}>
              <Select
                value={kind}
                onChange={(v) => setKind(v as "Partial" | "Full")}
                options={[
                  { value: "Partial", label: "Partial" },
                  { value: "Full", label: "Full (close)" },
                ]}
              />
            </div>
          </div>
          <FieldError msg={fe.amount} />
        </div>
        <p style={{ fontSize: 12.5, margin: "10px 0 8px", color: "var(--muted)" }}>
          {full
            ? <>Closes the investment. Payable now: <strong>{fmt(total)}</strong> (includes interest earned so far).</>
            : amountNum > 0
              ? <>Payable now: <strong>{fmt(total)}</strong>. The remaining payouts are reduced to match what stays invested.</>
              : <>Principal held: <strong>{fmt(held)}</strong></>}
        </p>
        <div className={fe.split ? "has-err" : undefined}>
          <SplitPaymentInput totalAmount={total} onChange={(s, r, bid) => { setSplit(s); setRemaining(r); setBankId(bid); }} />
          <FieldError msg={fe.split} />
        </div>
        {err && <div className="notice" style={{ marginTop: 10 }}>{err}</div>}
      </div>
      <div className="ft">
        <button className="btn" disabled={saving || total <= 0 || !balanced} onClick={save}>{saving ? "Withdrawing…" : full ? "Withdraw & Close" : "Withdraw"}</button>
      </div>
    </>
  );
}
