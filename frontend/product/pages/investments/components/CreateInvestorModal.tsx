"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/product/components/Modal";
import { Select } from "@/product/components/ui/Select";
import { createCustomer, type CustomerView } from "@/product/pages/customers/services/customerService";
import { listActiveBranches, type BranchView } from "@/product/pages/branches/services/branchService";
import { getSelectedBranchId } from "@/product/services/branchSelection";

/* Inline "+ Add new investor" flow reached from the New Investment picker
 * (NewInvestmentModal.tsx's SearchableSelect, via its onCreateNew prop) —
 * mirrors personal-loans/components/CreateCustomerModal.tsx's shape exactly,
 * but always sends customerType: "Investor" and collects the PAN/Aadhaar and
 * bank-payout details backend/internal/customer/service.go requires for that
 * type (PAN, Aadhaar, BankAccountName/BankAccountNumber/BankIFSC) instead of
 * the personal-loan-specific fields (FatherName/District/…). PAN and Aadhaar
 * are validated the same way here as on the server (see service.go's
 * validate) so a malformed value is caught before the round trip. */
export function CreateInvestorModalContent({ onCreated }: { onCreated: (customer: CustomerView) => void }) {
  const { closeModal } = useModal();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [branches, setBranches] = useState<BranchView[]>([]);
  const [branchId, setBranchId] = useState<number | "">("");
  const [address, setAddress] = useState("");
  const [pan, setPan] = useState("");
  const [aadhaar, setAadhaar] = useState("");
  const [bankAccountName, setBankAccountName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankIfsc, setBankIfsc] = useState("");

  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listActiveBranches()
      .then((list) => {
        setBranches(list);
        if (!list.length) return;
        // Default to whatever branch the switcher currently has selected
        // (an Administrator/Management session can see every branch, so
        // there's no other cue) rather than always the list's first
        // branch — a mismatch here silently orphans the new investor:
        // it's created under some other branch, so once the picker's
        // in-memory selection is gone (e.g. after a refresh) any search
        // scoped to the currently selected branch (GetBranchScope on the
        // backend) simply never finds it again.
        const selected = getSelectedBranchId();
        const fallback = selected && list.some((b) => b.id === selected) ? selected : list[0].id;
        setBranchId((cur) => cur || fallback);
      })
      .catch(() => setErr("Could not load branches — try again later."));
  }, []);

  async function save() {
    const n = name.trim();
    const p = phone.trim();
    if (n.length < 3) { setErr("Please enter the investor's full name."); return; }
    if (!/^\d{10}$/.test(p)) { setErr("Please enter a valid 10-digit mobile number."); return; }
    if (!branchId) { setErr("Please select a branch."); return; }
    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan.trim().toUpperCase())) { setErr("Please enter a valid PAN (e.g. ABCDE1234F)."); return; }
    if (!/^\d{12}$/.test(aadhaar.trim())) { setErr("Please enter a valid 12-digit Aadhaar number."); return; }
    if (!bankAccountName.trim()) { setErr("Please enter the bank account holder's name."); return; }
    if (!bankAccountNumber.trim()) { setErr("Please enter the bank account number."); return; }
    if (!bankIfsc.trim()) { setErr("Please enter the bank IFSC code."); return; }

    setSaving(true);
    setErr("");
    try {
      const c = await createCustomer({
        name: n,
        phone: p,
        dob: "",
        address: address.trim(),
        branchId: Number(branchId),
        photoUrl: "",
        identityProofUrl: "",
        addressProofUrl: "",
        kycDocumentUrl: "",
        pan: pan.trim().toUpperCase(),
        aadhaar: aadhaar.trim(),
        nomineeName: "",
        nomineeRelation: "",
        nomineePhone: "",
        customerType: "Investor",
        bankAccountName: bankAccountName.trim(),
        bankAccountNumber: bankAccountNumber.trim(),
        bankIfsc: bankIfsc.trim().toUpperCase(),
      });
      onCreated(c);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create investor.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Add New Investor</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow c2">
          <div><label className="f">Full Name *</label><input className="inp" placeholder="e.g. Radha Menon" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="f">Mobile Number *</label><input className="inp" inputMode="numeric" placeholder="10-digit mobile" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">Branch *</label>
            <Select
              value={branchId === "" ? "" : String(branchId)}
              onChange={(v) => setBranchId(v ? Number(v) : "")}
              options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
              placeholder="Select branch…"
            />
          </div>
          <div><label className="f">Address</label><input className="inp" placeholder="House / street" value={address} onChange={(e) => setAddress(e.target.value)} /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">PAN *</label><input className="inp" placeholder="e.g. ABCDE1234F" maxLength={10} value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} /></div>
          <div><label className="f">Aadhaar Number *</label><input className="inp" inputMode="numeric" placeholder="12-digit Aadhaar" maxLength={12} value={aadhaar} onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, ""))} /></div>
        </div>
        <div className="frow"><div><label className="f">Bank Account Holder Name *</label><input className="inp" placeholder="As per bank records" value={bankAccountName} onChange={(e) => setBankAccountName(e.target.value)} /></div></div>
        <div className="frow c2">
          <div><label className="f">Bank Account Number *</label><input className="inp" placeholder="Account number" value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} /></div>
          <div><label className="f">Bank IFSC *</label><input className="inp" placeholder="e.g. SBIN0001234" maxLength={11} value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value.toUpperCase())} /></div>
        </div>
        {err && <div className="notice" style={{ marginTop: 10 }}>{err}</div>}
      </div>
      <div className="ft">
        <button className="btn plain" style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase" }} onClick={closeModal}>Cancel</button>
        <button className="btn" disabled={saving} onClick={save}>{saving ? "Creating…" : "Create Investor"}</button>
      </div>
    </>
  );
}
