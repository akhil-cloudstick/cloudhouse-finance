"use client";

import { useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { ApiError } from "@/common/services/httpClient";
import { fmt } from "@/common/utils/format";
import { SearchableSelect } from "@/common/components/ui/SearchableSelect";
import { searchCustomersPage, type CustomerView } from "@/modules/customers/services/customerService";
import { VerifiedBadge } from "@/modules/customers/components/VerifiedBadge";
import { CreateCustomerModalContent } from "@/modules/personal-loans/components/CreateCustomerModal";
import {
  createPersonalLoan,
  type Frequency,
  type InterestType,
} from "@/modules/personal-loans/services/personalLoanService";

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
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  // Toggles this same mounted component over to the inline "+ Add new
  // customer" form (CreateCustomerModal.tsx) instead of swapping the modal
  // via useModal — swapping would unmount this component and lose every
  // field already typed (principal, tenure, …). Kept local rather than
  // lifted, since only this modal ever needs it.
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  const principalNum = +principal || 0;
  const interestValueNum = +interestValue || 0;
  const tenureNum = +tenureCount || 0;
  const interestAmount = principalNum > 0 ? computeInterest(principalNum, interestType, interestValueNum) : 0;
  const disbursedAmount = Math.round((principalNum - interestAmount) * 100) / 100;
  const installmentAmount = tenureNum > 0 ? Math.round((principalNum / tenureNum) * 100) / 100 : 0;

  async function save() {
    if (!customerId || !customerBranchId) { setErr("Please select a customer."); return; }
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
      <CreateCustomerModalContent
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
        <div className="frow"><div><label className="f">Collection Frequency *</label>
          <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
            {(["Daily", "Weekly", "Monthly"] as Frequency[]).map((f) => (
              <label key={f} className="cradio" style={{ fontSize: 13, alignItems: "center" }}>
                <input type="radio" name="frequency" checked={frequency === f} onChange={() => setFrequency(f)} />
                <span className="mark" /><span>{f}</span>
              </label>
            ))}
          </div>
        </div></div>

        {principalNum > 0 && tenureNum > 0 && (
          <div className="notice" style={{ marginTop: 4 }}>
            <div>Interest amount: <strong>{fmt(interestAmount)}</strong></div>
            <div>Disbursed to customer: <strong>{fmt(disbursedAmount)}</strong></div>
            <div>Installment amount: <strong>{fmt(installmentAmount)}</strong> / {frequency}</div>
            <div>Repayment obligation: <strong>{fmt(principalNum)}</strong></div>
          </div>
        )}

        {err && <div className="notice" style={{ marginTop: 10 }}>{err}</div>}
      </div>
      <div className="ft">
        <button className="btn plain" style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase" }} onClick={closeModal}>Cancel</button>
        <button className="btn" disabled={saving} onClick={save}>{saving ? "Creating…" : "Create & Disburse"}</button>
      </div>
    </>
  );
}
