"use client";

import { useState } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { ApiError } from "@/product/services/httpClient";
import { fmt } from "@/product/utils/format";
import { SearchableSelect } from "@/product/components/ui/SearchableSelect";
import { searchCustomersPage, type CustomerView } from "@/product/pages/customers/services/customerService";
import { VerifiedBadge } from "@/product/pages/customers/components/VerifiedBadge";
import { RegisterCustomerModalContent } from "@/product/components/modals/RegisterCustomerModal";
import {
  createPersonalLoan,
  type Frequency,
  type InterestType,
} from "@/product/pages/personal-loans/services/personalLoanService";
import { useBalanceInHand } from "@/product/hooks/useBalanceInHand";

/* Client-side mirror of backend/internal/personalloan/service.go's
 * computeInterest — used only to render a live preview before submit; the
 * backend recomputes and is the source of truth. */
function computeInterest(principal: number, interestType: InterestType, value: number): number {
  const raw = interestType === "Percentage" ? (principal * value) / 100 : value;
  return Math.round(raw * 100) / 100;
}

/* "New Personal Loan" — a modal (not a page) launched from PersonalLoans.tsx's
 * "+ New Personal Loan" button. No PAN/Aadhaar verification is required for
 * this product, unlike Gold Loan's NewLoan.tsx — any existing Customer may
 * be picked. Creation and disbursement happen as one step: submitting this
 * form both creates the loan and (implicitly) hands the customer
 * DisbursedAmount in cash. */
export function NewPersonalLoanModalContent({ onSaved }: { onSaved: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();

  const [customerId, setCustomerId] = useState<number | undefined>(undefined);
  const [customerBranchId, setCustomerBranchId] = useState<number | undefined>(undefined);
  const [customerLabel, setCustomerLabel] = useState("");
  const [principal, setPrincipal] = useState("");
  const [interestType, setInterestType] = useState<InterestType>("Flat");
  const [interestValue, setInterestValue] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("Daily");
  const [tenureCount, setTenureCount] = useState("");
  // Default unchecked — today's behavior (interest withheld upfront, customer
  // repays principal only) is unchanged unless staff opts in.
  const [fullDisbursement, setFullDisbursement] = useState(false);
  // Both optional — left blank, the backend defaults penal rate to the
  // loan's own effective interest rate and grace period to 0 (see
  // CreateInput.PenalInterestRate's doc comment).
  const [penalInterestRate, setPenalInterestRate] = useState("");
  const [gracePeriodDays, setGracePeriodDays] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  // Toggles this same mounted component over to the inline "+ Add new
  // customer" form (RegisterCustomerModalContent, via its `onCreated` prop)
  // instead of swapping the modal via useModal — swapping would unmount
  // this component and lose every field already typed (principal, tenure,
  // …). Kept local rather than lifted, since only this modal ever needs it.
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  const principalNum = +principal || 0;
  const interestValueNum = +interestValue || 0;
  const tenureNum = +tenureCount || 0;
  const interestAmount = principalNum > 0 ? computeInterest(principalNum, interestType, interestValueNum) : 0;
  // Mirrors backend/internal/personalloan/service.go's CreateLoan branch:
  // unchecked disburses Principal-Interest and the obligation stays
  // Principal; checked disburses the full Principal and the obligation
  // becomes Principal+Interest instead.
  const disbursedAmount = fullDisbursement
    ? principalNum
    : Math.round((principalNum - interestAmount) * 100) / 100;
  const obligation = fullDisbursement
    ? Math.round((principalNum + interestAmount) * 100) / 100
    : principalNum;
  const installmentAmount = tenureNum > 0 ? Math.round((obligation / tenureNum) * 100) / 100 : 0;
  // Disbursement is blocked until the branch has enough balance in hand.
  const balanceInHand = useBalanceInHand(customerBranchId);
  const insufficient = balanceInHand !== null && disbursedAmount > balanceInHand + 0.005;

  async function save() {
    if (!customerId || !customerBranchId) { setErr("Please select a customer."); return; }
    if (insufficient) { setErr("Insufficient balance in hand to disburse this loan."); return; }
    if (!principalNum || principalNum <= 0) { setErr("Please enter the principal amount."); return; }
    if (!tenureNum || tenureNum <= 0) { setErr("Please enter the number of installments."); return; }
    if (interestValueNum < 0) { setErr("Interest value must not be negative."); return; }
    if (interestAmount >= principalNum) { setErr("Interest amount must be less than the principal amount."); return; }

    setSaving(true);
    setErr("");
    try {
      await createPersonalLoan({
        branchId: customerBranchId,
        customerId,
        principalAmount: principalNum,
        interestType,
        interestValue: interestValueNum,
        frequency,
        tenureCount: tenureNum,
        fullDisbursement,
        penalInterestRate: penalInterestRate ? +penalInterestRate : undefined,
        gracePeriodDays: gracePeriodDays ? +gracePeriodDays : undefined,
      });
      toast(`Personal loan created — ${fmt(disbursedAmount)} disbursed to the customer`);
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not create the loan — try again.");
    } finally {
      setSaving(false);
    }
  }

  if (creatingCustomer) {
    return (
      <RegisterCustomerModalContent
        onCreated={(c) => {
          setCustomerId(+c.id);
          setCustomerBranchId(c.branchId);
          setCustomerLabel(`${c.name} (${c.code})`);
          setCreatingCustomer(false);
        }}
      />
    );
  }

  return (
    <>
      <div className="hd"><h3>New Personal Loan</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow"><div><label className="f">Customer *</label>
          <SearchableSelect<CustomerView>
            value={customerLabel}
            onChange={(id, item) => { setCustomerId(+id); setCustomerBranchId(item.branchId); setCustomerLabel(`${item.name} (${item.code})`); }}
            fetchFn={searchCustomersPage}
            getLabel={(c) => `${c.name} (${c.code})`}
            /* Same treatment as the gold-loan picker (NewLoan.tsx): name
             * plus a "Verified" badge when fully verified, and no negative
             * text otherwise. */
            renderLabel={(c) => (
              <span className="ss-name">
                <b>{c.name} ({c.code})</b>
                <VerifiedBadge customer={c} />
              </span>
            )}
            getId={(c) => c.id}
            placeholder="Search for a customer…"
            onCreateNew={() => setCreatingCustomer(true)}
            createNewLabel="+ Add new customer"
          /></div></div>
        <div className="frow c2">
          <div><label className="f">Principal Amount (₹) *</label><input className="inp" type="number" min={1} placeholder="e.g. 5000" value={principal} onChange={(e) => setPrincipal(e.target.value)} /></div>
          <div><label className="f">Number of Installments *</label><input className="inp" type="number" min={1} placeholder="e.g. 50" value={tenureCount} onChange={(e) => setTenureCount(e.target.value)} /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">Interest Type *</label>
            <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
              <label className="cradio" style={{ fontSize: 13, alignItems: "center" }}>
                <input type="radio" name="interestType" checked={interestType === "Flat"} onChange={() => setInterestType("Flat")} />
                <span className="mark" /><span>Flat (₹)</span>
              </label>
              <label className="cradio" style={{ fontSize: 13, alignItems: "center" }}>
                <input type="radio" name="interestType" checked={interestType === "Percentage"} onChange={() => setInterestType("Percentage")} />
                <span className="mark" /><span>Percentage (%)</span>
              </label>
            </div>
          </div>
          <div><label className="f">Interest Value *</label><input className="inp" type="number" min={0} step={0.01} placeholder={interestType === "Flat" ? "e.g. 100" : "e.g. 2"} value={interestValue} onChange={(e) => setInterestValue(e.target.value)} /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">Collection Frequency *</label>
            <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
              {(["Daily", "Weekly", "Monthly"] as Frequency[]).map((f) => (
                <label key={f} className="cradio" style={{ fontSize: 13, alignItems: "center" }}>
                  <input type="radio" name="frequency" checked={frequency === f} onChange={() => setFrequency(f)} />
                  <span className="mark" /><span>{f}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="cradio" style={{ fontSize: 13, alignItems: "center", marginTop: 24 }}>
              <input type="checkbox" checked={fullDisbursement} onChange={(e) => setFullDisbursement(e.target.checked)} />
              <span className="mark" /><span>Full Amount — disburse the full principal now, no interest withheld upfront</span>
            </label>
          </div>
        </div>

        <div className="frow c2">
          <div><label className="f">Penal Interest Rate (% p.a.)</label><input className="inp" type="number" min={0} step={0.01} placeholder="Defaults to the loan's own interest rate" value={penalInterestRate} onChange={(e) => setPenalInterestRate(e.target.value)} /></div>
          <div><label className="f">Grace Period (days)</label><input className="inp" type="number" min={0} placeholder="e.g. 5" value={gracePeriodDays} onChange={(e) => setGracePeriodDays(e.target.value)} /></div>
        </div>

        {principalNum > 0 && tenureNum > 0 && (
          <div className="notice" style={{ marginTop: 4 }}>
            <div>Interest amount: <strong>{fmt(interestAmount)}</strong></div>
            <div>Disbursed to customer: <strong>{fmt(disbursedAmount)}</strong></div>
            <div>Installment amount: <strong>{fmt(installmentAmount)}</strong> / {frequency}</div>
            <div>Repayment obligation: <strong>{fmt(obligation)}</strong></div>
          </div>
        )}
        {balanceInHand !== null && (
          <p style={{ fontSize: 12.5, marginTop: 8, color: insufficient ? "var(--red)" : "var(--muted)" }}>
            Balance in hand: <strong>{fmt(balanceInHand)}</strong>
            {insufficient && " — not enough to disburse this loan. Add cash first."}
          </p>
        )}

        {err && <div className="notice" style={{ marginTop: 10 }}>{err}</div>}
      </div>
      <div className="ft">
        <button className="btn plain" style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase" }} onClick={closeModal}>Cancel</button>
        <button className="btn" disabled={saving || insufficient} onClick={save}>{saving ? "Creating…" : "Create & Disburse"}</button>
      </div>
    </>
  );
}
