"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { ApiError } from "@/product/services/httpClient";
import { fmt } from "@/product/utils/format";
import { SearchableSelect } from "@/product/components/ui/SearchableSelect";
import { Select } from "@/product/components/ui/Select";
import { searchInvestorsPage, type CustomerView } from "@/product/pages/customers/services/customerService";
import { CreateInvestorModalContent } from "@/product/pages/investments/components/CreateInvestorModal";
import { useAuth } from "@/product/providers/auth-context";
import {
  createInvestment,
  listInvestmentPlans,
  type BackendInvestmentPlan,
} from "@/product/pages/investments/services/investmentService";

/* "New Investment" — a modal (not a page) launched from Investments.tsx's
 * "+ New Investment" button, mirroring personal-loans/components/
 * NewPersonalLoanModal.tsx's shape: pick an (Investor-only) customer, pick
 * an active plan, enter the principal — the backend snapshots the plan's
 * rate/frequency/tenure onto the Investment and generates the full payout
 * schedule in one step (see backend/internal/investment/service.go's
 * CreateInvestment). */
export function NewInvestmentModalContent({ onSaved }: { onSaved: () => void }) {
  const canCreateCustomer = useAuth().can("Customer_Management", "can_create_customer");
  const { closeModal } = useModal();
  const toast = useToast();

  const [customerId, setCustomerId] = useState<number | undefined>(undefined);
  const [customerBranchId, setCustomerBranchId] = useState<number | undefined>(undefined);
  const [customerLabel, setCustomerLabel] = useState("");
  const [plans, setPlans] = useState<BackendInvestmentPlan[]>([]);
  const [planId, setPlanId] = useState<number | "">("");
  const [principal, setPrincipal] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  // Same "swap this same mounted component to an inline create form instead
  // of stacking a new modal" trick as NewPersonalLoanModal.tsx's
  // creatingCustomer, so the customer/plan/principal fields already typed
  // aren't lost.
  const [creatingInvestor, setCreatingInvestor] = useState(false);

  useEffect(() => {
    listInvestmentPlans(true)
      .then((list) => { setPlans(list); if (list.length) setPlanId((cur) => cur || list[0].id); })
      .catch(() => setErr("Could not load investment plans — try again later."));
  }, []);

  const plan = plans.find((p) => p.id === planId);
  const principalNum = +principal || 0;

  async function save() {
    if (!customerId || !customerBranchId) { setErr("Please select an investor."); return; }
    if (!planId) { setErr("Please select an investment plan."); return; }
    if (!principalNum || principalNum <= 0) { setErr("Please enter the principal amount."); return; }
    if (plan && principalNum < plan.minPrincipal) { setErr(`Principal amount is below this plan's minimum of ${fmt(plan.minPrincipal)}.`); return; }

    setSaving(true);
    setErr("");
    try {
      await createInvestment({
        branchId: customerBranchId,
        customerId,
        planId: Number(planId),
        principalAmount: principalNum,
      });
      toast(`Investment created — ${fmt(principalNum)} deposited`);
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not create the investment — try again.");
    } finally {
      setSaving(false);
    }
  }

  if (creatingInvestor) {
    return (
      <CreateInvestorModalContent
        onCreated={(c) => {
          setCustomerId(+c.id);
          setCustomerBranchId(c.branchId);
          setCustomerLabel(`${c.name} (${c.code})`);
          setCreatingInvestor(false);
        }}
      />
    );
  }

  return (
    <>
      <div className="hd"><h3>New Investment</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow"><div><label className="f">Investor *</label>
          <SearchableSelect<CustomerView>
            value={customerLabel}
            onChange={(id, item) => { setCustomerId(+id); setCustomerBranchId(item.branchId); setCustomerLabel(`${item.name} (${item.code})`); }}
            fetchFn={searchInvestorsPage}
            getLabel={(c) => `${c.name} (${c.code})`}
            getId={(c) => c.id}
            placeholder="Search for an investor…"
            onCreateNew={canCreateCustomer ? () => setCreatingInvestor(true) : undefined}
            createNewLabel="+ Add new investor"
          /></div></div>
        <div className="frow c2">
          <div><label className="f">Investment Plan *</label>
            <Select
              value={planId === "" ? "" : String(planId)}
              onChange={(v) => setPlanId(v ? Number(v) : "")}
              options={plans.map((p) => ({ value: String(p.id), label: `${p.name} — ${p.interestRatePercent}% ${p.payoutFrequency}, ${p.tenureMonths}mo` }))}
              placeholder={plans.length ? "Select plan…" : "No active plans"}
            />
          </div>
          <div><label className="f">Principal Amount (₹) *</label><input className="inp" type="number" min={1} placeholder="e.g. 100000" value={principal} onChange={(e) => setPrincipal(e.target.value)} /></div>
        </div>

        {plan && principalNum > 0 && (
          <div className="notice" style={{ marginTop: 4 }}>
            <div>Interest: <strong>{plan.interestRateType} @ {plan.interestRatePercent}% p.a.</strong>, paid <strong>{plan.payoutFrequency}</strong></div>
            <div>Tenure: <strong>{plan.tenureMonths} months</strong></div>
            <div>Principal deposited: <strong>{fmt(principalNum)}</strong></div>
          </div>
        )}

        {err && <div className="notice" style={{ marginTop: 10 }}>{err}</div>}
      </div>
      <div className="ft">
        <button className="btn plain" style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase" }} onClick={closeModal}>Cancel</button>
        <button className="btn" disabled={saving} onClick={save}>{saving ? "Creating…" : "Create Investment"}</button>
      </div>
    </>
  );
}
