"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { Select } from "@/common/components/ui/Select";
import { createCustomer } from "@/modules/customers/services/customerService";
import { type CustomerView } from "@/modules/customers/types/customer-types";
import { listActiveBranches } from "@/modules/branches/services/branchService";
import { type BranchView } from "@/modules/branches/types/branch-types";
import { useBranding } from "@/common/providers/BrandingProvider";
import { useLockedBranchId, useShowBranch } from "@/common/hooks/use-branch-switch";
import { getSelectedBranchId } from "@/common/services/branchSelection";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";

// Which field a server message is about, by its words (first match wins).
const SERVER_FIELDS: Record<string, RegExp> = {
  name: /name/i, phone: /phone|mobile/i, branch: /branch/i, pan: /\bpan\b/i, aadhaar: /aadhaar/i, bankAccountName: /holder/i, bankAccountNumber: /account/i, bankIfsc: /ifsc/i,
};

type CreateInvestorModalContentProps = { onCreated: (customer: CustomerView) => void };

/* Inline "+ Add new investor" flow reached from the New Investment picker
 * (NewInvestmentModal.tsx's SearchableSelect, via its onCreateNew prop) —
 * mirrors personal-loans/components/CreateCustomerModal.tsx's shape exactly,
 * but always sends customerType: "Investor" and collects the PAN/Aadhaar and
 * bank-payout details backend/internal/customer/service.go requires for that
 * type (PAN, Aadhaar, BankAccountName/BankAccountNumber/BankIFSC) instead of
 * the personal-loan-specific fields (FatherName/District/…). PAN and Aadhaar
 * are validated the same way here as on the server (see service.go's
 * validate) so a malformed value is caught before the round trip. */
export function CreateInvestorModalContent({ onCreated }: CreateInvestorModalContentProps) {
  const { closeModal } = useModal();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [branches, setBranches] = useState<BranchView[]>([]);
  // Single-branch business: the one branch is preselected and the picker locked.
  const { singleBranch } = useBranding();
  // Single-branch plan: no branch is ever shown — the field is not rendered.
  const showBranch = useShowBranch();
  // Locked (and defaulted) to the global branch selection when one is
  // active, the same way a single-branch business locks it.
  const lockedBranchId = useLockedBranchId();
  const branchLocked = singleBranch || lockedBranchId != null;
  const [branchId, setBranchId] = useState<number | "">(lockedBranchId || "");
  const [address, setAddress] = useState("");
  const [pan, setPan] = useState("");
  const [aadhaar, setAadhaar] = useState("");
  const [bankAccountName, setBankAccountName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankIfsc, setBankIfsc] = useState("");

  const [err, setErr] = useState("");
  // Validation messages, each shown under the field it is about; `err` keeps the ones that fit no field.
  const [fe, setFe] = useState<Record<string, string>>({});
  const fail = (field: string, msg: string) => { setErr(""); setFe({ [field]: msg }); };
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
    if (n.length < 3) { fail("name", "Please enter the investor's full name."); return; }
    if (!/^\d{10}$/.test(p)) { fail("phone", "Please enter a valid 10-digit mobile number."); return; }
    if (!branchId) { fail("branch", "Please select a branch."); return; }
    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan.trim().toUpperCase())) { fail("pan", "Please enter a valid PAN (e.g. ABCDE1234F)."); return; }
    if (!/^\d{12}$/.test(aadhaar.trim())) { fail("aadhaar", "Please enter a valid 12-digit Aadhaar number."); return; }
    if (!bankAccountName.trim()) { fail("bankAccountName", "Please enter the bank account holder's name."); return; }
    if (!bankAccountNumber.trim()) { fail("bankAccountNumber", "Please enter the bank account number."); return; }
    if (!bankIfsc.trim()) { fail("bankIfsc", "Please enter the bank IFSC code."); return; }

    setSaving(true);
    setErr("");
    setFe({});
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
      const msg = e instanceof Error ? e.message : "Failed to create investor.";
      const field = fieldForMessage(msg, SERVER_FIELDS);
      if (field) fail(field, msg); else setErr(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Add New Investor</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow c2">
          <div className={fe.name ? "has-err" : undefined}><label className="f">Full Name *</label><input className="inp" placeholder="e.g. Radha Menon" value={name} onChange={(e) => setName(e.target.value)} /><FieldError msg={fe.name} /></div>
          <div className={fe.phone ? "has-err" : undefined}><label className="f">Mobile Number *</label><input className="inp" inputMode="numeric" placeholder="10-digit mobile" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} /><FieldError msg={fe.phone} /></div>
        </div>
        <div className={showBranch ? "frow c2" : "frow"}>
          {showBranch && (
            <div className={fe.branch ? "has-err" : undefined}><label className="f">Branch *</label>
              <Select
                value={branchId === "" ? "" : String(branchId)}
                onChange={(v) => setBranchId(v ? Number(v) : "")}
                disabled={branchLocked}
                options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
                placeholder="Select branch…"
              /><FieldError msg={fe.branch} />
            </div>
          )}
          <div><label className="f">Address</label><input className="inp" placeholder="House / street" value={address} onChange={(e) => setAddress(e.target.value)} /></div>
        </div>
        <div className="frow c2">
          <div className={fe.pan ? "has-err" : undefined}><label className="f">PAN *</label><input className="inp" placeholder="e.g. ABCDE1234F" maxLength={10} value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} /><FieldError msg={fe.pan} /></div>
          <div className={fe.aadhaar ? "has-err" : undefined}><label className="f">Aadhaar Number *</label><input className="inp" inputMode="numeric" placeholder="12-digit Aadhaar" maxLength={12} value={aadhaar} onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, ""))} /><FieldError msg={fe.aadhaar} /></div>
        </div>
        <div className="frow"><div className={fe.bankAccountName ? "has-err" : undefined}><label className="f">Bank Account Holder Name *</label><input className="inp" placeholder="As per bank records" value={bankAccountName} onChange={(e) => setBankAccountName(e.target.value)} /><FieldError msg={fe.bankAccountName} /></div></div>
        <div className="frow c2">
          <div className={fe.bankAccountNumber ? "has-err" : undefined}><label className="f">Bank Account Number *</label><input className="inp" placeholder="Account number" value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} /><FieldError msg={fe.bankAccountNumber} /></div>
          <div className={fe.bankIfsc ? "has-err" : undefined}><label className="f">Bank IFSC *</label><input className="inp" placeholder="e.g. SBIN0001234" maxLength={11} value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value.toUpperCase())} /><FieldError msg={fe.bankIfsc} /></div>
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
