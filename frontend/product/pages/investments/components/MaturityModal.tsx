"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { ApiError } from "@/product/services/httpClient";
import { fmt, fmtDate } from "@/product/utils/format";
import { Select } from "@/product/components/ui/Select";
import {
  matureInvestment,
  listInvestmentPlans,
  type BackendInvestment,
  type BackendInvestmentPlan,
  type MaturityAction,
} from "@/product/pages/investments/services/investmentService";

/* "Close / Renew" — the one explicit admin decision a Matured investment
 * requires (see backend/internal/investment/service.go's MatureInvestment
 * doc comment: nothing happens automatically at maturity beyond flagging
 * the investment Matured). Close appends a final principal-return payout
 * row to the existing schedule (left Pending for staff to disburse the
 * same way as any other payout); Renew opens a brand-new Investment against
 * a (possibly different) plan/principal, linked back via
 * renewedFromInvestmentId/renewedToInvestmentId. */
export function MaturityModalContent({ investment, onSaved }: { investment: BackendInvestment; onSaved: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();

  const [action, setAction] = useState<MaturityAction>("Close");
  const [plans, setPlans] = useState<BackendInvestmentPlan[]>([]);
  const [planId, setPlanId] = useState<number | "">("");
  const [principal, setPrincipal] = useState(String(investment.principalAmount));
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listInvestmentPlans(true)
      .then((list) => { setPlans(list); if (list.length) setPlanId((cur) => cur || list[0].id); })
      .catch(() => setErr("Could not load investment plans — try again later."));
  }, []);

  const principalNum = +principal || 0;

  async function save() {
    if (action === "Renew") {
      if (!planId) { setErr("Please select an investment plan for the renewed investment."); return; }
      if (!principalNum || principalNum <= 0) { setErr("Please enter the principal amount for the renewed investment."); return; }
    }
    setSaving(true);
    setErr("");
    try {
      await matureInvestment(investment.id, {
        action,
        planId: action === "Renew" ? Number(planId) : undefined,
        principalAmount: action === "Renew" ? principalNum : undefined,
      });
      toast(action === "Close" ? "Investment closed — principal return payout added to the schedule" : "Investment renewed");
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not apply the maturity decision — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Maturity Decision — {investment.investmentNumber}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
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

        {action === "Renew" && (
          <div className="frow c2">
            <div><label className="f">New Investment Plan *</label>
              <Select
                value={planId === "" ? "" : String(planId)}
                onChange={(v) => setPlanId(v ? Number(v) : "")}
                options={plans.map((p) => ({ value: String(p.id), label: `${p.name} — ${p.interestRatePercent}% ${p.payoutFrequency}, ${p.tenureMonths}mo` }))}
                placeholder={plans.length ? "Select plan…" : "No active plans"}
              />
            </div>
            <div><label className="f">Principal Amount (₹) *</label><input className="inp" type="number" min={1} value={principal} onChange={(e) => setPrincipal(e.target.value)} /></div>
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
