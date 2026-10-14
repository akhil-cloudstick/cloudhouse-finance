"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { ApiError } from "@/common/services/httpClient";
import { fmt, fmtDate } from "@/common/utils/format";
import { Select } from "@/common/components/ui/Select";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/common/components/SplitPaymentInput";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";
import { matureInvestment, listInvestmentPlans } from "@/modules/investments/services/investmentService";
import { type BackendInvestment, type BackendInvestmentPlan, type MaturityAction } from "@/modules/investments/types/investment-types";

// Which field a server message is about, by its words (first match wins).
const SERVER_FIELDS: Record<string, RegExp> = {
  split: /payment|breakdown|bank|cheque|upi/i, plan: /plan/i, principal: /principal|amount/i,
};

type MaturityModalContentProps = { investment: BackendInvestment; onSaved: () => void };

/* "Close / Renew" — the one explicit admin decision a Matured investment
 * requires (see backend/internal/investment/service.go's MatureInvestment
 * doc comment: nothing happens automatically at maturity beyond flagging
 * the investment Matured). Close appends a final principal-return payout
 * row to the existing schedule (left Pending for staff to disburse the
 * same way as any other payout); Renew opens a brand-new Investment against
 * a (possibly different) plan/principal, linked back via
 * renewedFromInvestmentId/renewedToInvestmentId. */
export function MaturityModalContent({ investment, onSaved }: MaturityModalContentProps) {
  const { closeModal } = useModal();
  const toast = useToast();

  const [action, setAction] = useState<MaturityAction>("Close");
  const [plans, setPlans] = useState<BackendInvestmentPlan[]>([]);
  const [planId, setPlanId] = useState<number | "">("");
  const [principal, setPrincipal] = useState(String(investment.principalAmount));
  const [err, setErr] = useState("");
  // Validation messages, each shown under the field it is about; `err` keeps the ones that fit no field.
  const [fe, setFe] = useState<Record<string, string>>({});
  const fail = (field: string, msg: string) => { setErr(""); setFe({ [field]: msg }); };
  const [saving, setSaving] = useState(false);
  // A live-engine investment is paid out in full when it is closed, so the close asks how.
  const isLive = investment.engine === "Live";
  const payable = Math.round(((investment.outstandingPrincipal || 0) + (investment.outstandingInterest || 0)) * 100) / 100;
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [remaining, setRemaining] = useState(0);
  const [bankId, setBankId] = useState<number | undefined>(undefined);

  useEffect(() => {
    listInvestmentPlans(true)
      .then((list) => { setPlans(list); if (list.length) setPlanId((cur) => cur || list[0].id); })
      .catch(() => setErr("Could not load investment plans — try again later."));
  }, []);

  const principalNum = +principal || 0;

  async function save() {
    if (action === "Renew") {
      if (!planId) { fail("plan", "Please select an investment plan for the renewed investment."); return; }
      if (!principalNum || principalNum <= 0) { fail("principal", "Please enter the principal amount for the renewed investment."); return; }
    }
    if (isLive && action === "Close") {
      if (Math.abs(remaining) >= 0.01) { fail("split", "The payment breakdown must add up to the amount payable."); return; }
      if (split.upiAmount + split.bankTransferAmount > 0 && !bankId) { fail("split", "Pick the bank the payout was made from."); return; }
    }
    setSaving(true);
    setErr("");
    setFe({});
    try {
      await matureInvestment(investment.id, {
        action,
        planId: action === "Renew" ? Number(planId) : undefined,
        principalAmount: action === "Renew" ? principalNum : undefined,
        ...(isLive && action === "Close" ? { cashAmount: split.cashAmount, upiAmount: split.upiAmount, bankTransferAmount: split.bankTransferAmount, chequeAmount: split.chequeAmount, bankId } : {}),
      });
      toast(action === "Close" ? (isLive ? "Investment closed — principal and interest paid out" : "Investment closed — principal return payout added to the schedule") : "Investment renewed");
      onSaved();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not apply the maturity decision — try again.";
      const field = fieldForMessage(msg, SERVER_FIELDS);
      if (field) fail(field, msg); else setErr(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Maturity Decision — {investment.investmentNumber}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="notice" style={{ marginBottom: 14 }}>
          This investment matured on <strong>{fmtDate(investment.maturityDate)}</strong>. Principal of <strong>{fmt(investment.principalAmount)}</strong> is outstanding — choose how to proceed.
        </div>
        <div className="frow"><div><label className="f">Decision *</label>
          <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
            <label className="cradio" style={{ fontSize: 13, alignItems: "center" }}>
              <input type="radio" name="maturityAction" checked={action === "Close"} onChange={() => setAction("Close")} />
              <span className="mark" /><span>Close — return principal</span>
            </label>
            <label className="cradio" style={{ fontSize: 13, alignItems: "center" }}>
              <input type="radio" name="maturityAction" checked={action === "Renew"} onChange={() => setAction("Renew")} />
              <span className="mark" /><span>Renew — roll over into a new investment</span>
            </label>
          </div>
        </div></div>

        {isLive && action === "Close" && (
          <>
            <p style={{ fontSize: 12.5, margin: "4px 0 8px", color: "var(--muted)" }}>
              Payable now: principal <strong>{fmt(investment.outstandingPrincipal || 0)}</strong> + interest to maturity <strong>{fmt(investment.outstandingInterest || 0)}</strong> = <strong>{fmt(payable)}</strong>
            </p>
            <div className="frow">
              <div className={fe.split ? "has-err" : undefined}>
                <SplitPaymentInput totalAmount={payable} onChange={(s, r, bid) => { setSplit(s); setRemaining(r); setBankId(bid); }} />
                <FieldError msg={fe.split} />
              </div>
            </div>
          </>
        )}

        {action === "Renew" && (
          <div className="frow c2">
            <div className={fe.plan ? "has-err" : undefined}><label className="f">New Investment Plan *</label>
              <Select
                value={planId === "" ? "" : String(planId)}
                onChange={(v) => setPlanId(v ? Number(v) : "")}
                options={plans.map((p) => ({ value: String(p.id), label: `${p.name} — ${p.interestRatePercent}% ${p.payoutFrequency}, ${p.tenureMonths}mo` }))}
                placeholder={plans.length ? "Select plan…" : "No active plans"}
              /><FieldError msg={fe.plan} />
            </div>
            <div className={fe.principal ? "has-err" : undefined}><label className="f">Principal Amount (₹) *</label><input className="inp" type="number" min={1} value={principal} onChange={(e) => setPrincipal(e.target.value)} /><FieldError msg={fe.principal} /></div>
          </div>
        )}

        {err && <div className="notice" style={{ marginTop: 10 }}>{err}</div>}
      </div>
      <div className="ft">
        <button className="btn plain" style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase" }} onClick={closeModal}>Cancel</button>
        <button className="btn" disabled={saving} onClick={save}>{saving ? "Saving…" : action === "Close" ? "Close Investment" : "Renew Investment"}</button>
      </div>
    </>
  );
}
