"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { ApiError } from "@/common/services/httpClient";
import { fmt } from "@/common/utils/format";
import { SearchableSelect } from "@/common/components/ui/SearchableSelect";
import { Select } from "@/common/components/ui/Select";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/common/components/SplitPaymentInput";
import { searchInvestorsPage } from "@/modules/customers/services/customerService";
import { type CustomerView } from "@/modules/customers/types/customer-types";
import { CreateInvestorModalContent } from "@/modules/investments/components/CreateInvestorModalContent";
import { useAuth } from "@/common/providers/AuthProvider";
import { createInvestment, listInvestmentPlans } from "@/modules/investments/services/investmentService";
import { type BackendInvestmentPlan } from "@/modules/investments/types/investment-types";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";

// Which field a server message is about, by its words (first match wins).
const SERVER_FIELDS: Record<string, RegExp> = {
  split: /payment|breakdown|bank|cheque|upi/i, investor: /investor|customer/i, plan: /plan/i, principal: /principal|amount/i,
};

type NewInvestmentModalContentProps = { onSaved: () => void };

/* "New Investment" — a modal (not a page) launched from Investments.tsx's
 * "+ New Investment" button, mirroring personal-loans/components/
 * NewPersonalLoanModal.tsx's shape: pick an (Investor-only) customer, pick
 * an active plan, enter the principal — the backend snapshots the plan's
 * rate/frequency/tenure onto the Investment and generates the full payout
 * schedule in one step (see backend/internal/investment/service.go's
 * CreateInvestment). */
export function NewInvestmentModalContent({ onSaved }: NewInvestmentModalContentProps) {
  const canCreateCustomer = useAuth().can("Customer_Management", "can_create_customer");
  const { closeModal } = useModal();
  const toast = useToast();

  const [customerId, setCustomerId] = useState<number | undefined>(undefined);
  const [customerBranchId, setCustomerBranchId] = useState<number | undefined>(undefined);
  const [customerLabel, setCustomerLabel] = useState("");
  const [plans, setPlans] = useState<BackendInvestmentPlan[]>([]);
  const [planId, setPlanId] = useState<number | "">("");
  const [principal, setPrincipal] = useState("");
  // How the investor pays the opening deposit (Cash / UPI / Bank Transfer /
  // Cheque), and the branch bank account a non-cash share lands in.
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [remaining, setRemaining] = useState(0);
  const [bankId, setBankId] = useState<number | undefined>(undefined);
  const [err, setErr] = useState("");
  // Validation messages, each shown under the field it is about; `err` keeps the ones that fit no field.
  const [fe, setFe] = useState<Record<string, string>>({});
  const fail = (field: string, msg: string) => { setErr(""); setFe({ [field]: msg }); };
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
    if (!customerId || !customerBranchId) { fail("investor", "Please select an investor."); return; }
    if (!planId) { fail("plan", "Please select an investment plan."); return; }
    if (!principalNum || principalNum <= 0) { fail("principal", "Please enter the principal amount."); return; }
    if (plan && principalNum < plan.minPrincipal) { fail("principal", `Principal amount is below this plan's minimum of ${fmt(plan.minPrincipal)}.`); return; }
    if (Math.abs(remaining) >= 0.01) { fail("split", "The payment breakdown must add up to the principal amount."); return; }

    setSaving(true);
    setErr("");
    setFe({});
    try {
      await createInvestment({
        branchId: customerBranchId,
        customerId,
        planId: Number(planId),
        principalAmount: principalNum,
        ...split,
        bankId,
      });
      toast(`Investment created — ${fmt(principalNum)} deposited`);
      onSaved();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not create the investment — try again.";
      const field = fieldForMessage(msg, SERVER_FIELDS);
      if (field) fail(field, msg); else setErr(msg);
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
      <div className="bd bd-scroll">
        <div className="frow"><div className={fe.investor ? "has-err" : undefined}><label className="f">Investor *</label>
          <SearchableSelect<CustomerView>
            value={customerLabel}
            onChange={(id, item) => { setCustomerId(+id); setCustomerBranchId(item.branchId); setCustomerLabel(`${item.name} (${item.code})`); }}
            fetchFn={searchInvestorsPage}
            searchHint="Searches: investor name, investor code, phone"
            getLabel={(c) => `${c.name} (${c.code})`}
            getId={(c) => c.id}
            placeholder="Search for an investor…"
            onCreateNew={canCreateCustomer ? () => setCreatingInvestor(true) : undefined}
            createNewLabel="+ Add new investor"
          /><FieldError msg={fe.investor} /></div></div>
        <div className="frow c2">
          <div className={fe.plan ? "has-err" : undefined}><label className="f">Investment Plan *</label>
            <Select
              value={planId === "" ? "" : String(planId)}
              onChange={(v) => setPlanId(v ? Number(v) : "")}
              options={plans.map((p) => ({ value: String(p.id), label: `${p.name} — ${p.interestRatePercent}% ${p.payoutFrequency}, ${p.tenureMonths}mo` }))}
              placeholder={plans.length ? "Select plan…" : "No active plans"}
            /><FieldError msg={fe.plan} />
          </div>
          <div className={fe.principal ? "has-err" : undefined}><label className="f">Principal Amount (₹) *</label><input className="inp" type="number" min={1} placeholder="e.g. 100000" value={principal} onChange={(e) => setPrincipal(e.target.value)} /><FieldError msg={fe.principal} /></div>
        </div>

        <div className="frow">
          <div className={fe.split ? "has-err" : undefined}>
            <SplitPaymentInput totalAmount={principalNum} onChange={(s, r, bid) => { setSplit(s); setRemaining(r); setBankId(bid); }} />
            <FieldError msg={fe.split} />
          </div>
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
