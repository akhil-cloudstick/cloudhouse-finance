"use client";

import { useEffect, useState } from "react";
import { stripDigits, panLiveError } from "@/common/utils/kyc";
import { useModal } from "@/common/components/ModalProvider";
import { Select } from "@/common/components/ui/Select";
import { createInvestor, updateInvestor, getInvestorAadhaarFull, sameIdentityMatches } from "@/modules/investments/services/investorService";
import { getCustomer, getCustomerAadhaarFull } from "@/modules/customers/services/customerService";
import { SameInvestorModalContent } from "@/modules/investments/components/SameInvestorModalContent";
import { useToast } from "@/common/components/ToastProvider";
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

// With `edit`, the form opens filled in with that investor and saves changes instead of creating one.
type CreateInvestorModalContentProps = { onCreated: (customer: CustomerView) => void; edit?: CustomerView };

/* Inline "+ Add new investor" flow reached from the New Investment picker
 * (NewInvestmentModal.tsx's SearchableSelect, via its onCreateNew prop) —
 * mirrors personal-loans/components/CreateCustomerModal.tsx's shape exactly,
 * but always sends customerType: "Investor" and collects the PAN/Aadhaar and
 * bank-payout details backend/internal/customer/service.go requires for that
 * type (PAN, Aadhaar, BankAccountName/BankAccountNumber/BankIFSC) instead of
 * the personal-loan-specific fields (FatherName/District/…). PAN and Aadhaar
 * are validated the same way here as on the server (see service.go's
 * validate) so a malformed value is caught before the round trip. */
export function CreateInvestorModalContent({ onCreated, edit }: CreateInvestorModalContentProps) {
  const { closeModal, openChildModal } = useModal();
  const toast = useToast();

  const [name, setName] = useState(edit?.name ?? "");
  const [phone, setPhone] = useState(edit?.phone ?? "");
  const [branches, setBranches] = useState<BranchView[]>([]);
  // Single-branch business: the one branch is preselected and the picker locked.
  const { singleBranch } = useBranding();
  // Single-branch plan: no branch is ever shown — the field is not rendered.
  const showBranch = useShowBranch();
  // Locked (and defaulted) to the global branch selection when one is
  // active, the same way a single-branch business locks it.
  const lockedBranchId = useLockedBranchId();
  const branchLocked = singleBranch || lockedBranchId != null;
  const [branchId, setBranchId] = useState<number | "">(edit?.branchId || lockedBranchId || "");
  const [address, setAddress] = useState(edit?.address ?? "");
  const [pan, setPan] = useState(edit?.pan ?? "");
  const [aadhaar, setAadhaar] = useState("");
  const [bankAccountName, setBankAccountName] = useState(edit?.bankAccountName ?? "");
  const [bankAccountNumber, setBankAccountNumber] = useState(edit?.bankAccountNumber ?? "");
  const [bankIfsc, setBankIfsc] = useState(edit?.bankIfsc ?? "");

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

  // The stored Aadhaar number is fetched to fill the field; if it cannot be, a blank field keeps the one on file.
  useEffect(() => {
    if (!edit) return;
    let live = true;
    getInvestorAadhaarFull(edit.id).then((a) => { if (live) setAadhaar(a); }).catch(() => {});
    return () => { live = false; };
  }, [edit]);

  // Set once the user confirms the person is an existing borrower: the form is then filled from that borrower.
  const [linkedCustomerId, setLinkedCustomerId] = useState<string | undefined>();

  // Fills the form with what the borrower already has on file; the rest is left for staff to complete.
  async function prefillFromBorrower(id: string) {
    try {
      const c = await getCustomer(id);
      setLinkedCustomerId(id);
      setName(c.name || "");
      setPhone(c.phone || "");
      if (c.address) setAddress(c.address);
      if (c.pan) setPan(c.pan);
      if (c.bankAccountName) setBankAccountName(c.bankAccountName);
      if (c.bankAccountNumber) setBankAccountNumber(c.bankAccountNumber);
      if (c.bankIfsc) setBankIfsc(c.bankIfsc);
      if (c.branchId && !lockedBranchId) setBranchId(c.branchId);
      getCustomerAadhaarFull(id).then((a) => { if (a) setAadhaar(a); }).catch(() => {});
      setErr("");
      setFe({});
      toast("Borrower details filled in — please complete the remaining fields");
    } catch {
      setErr("Could not load the borrower's details.");
    }
  }

  // confirmSamePerson: the user has said the number already on file belongs to this same person.
  async function save(confirmSamePerson = false) {
    const n = name.trim();
    const p = phone.trim();
    // Every problem is shown at once, each beside its own field.
    const errors: Record<string, string> = {};
    if (n.length < 3) errors["name"] ??= "Please enter the investor's full name.";
    if (!/^\d{10}$/.test(p)) errors["phone"] ??= "Please enter a valid 10-digit mobile number.";
    if (!branchId) errors["branch"] ??= "Please select a branch.";
    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan.trim().toUpperCase())) errors["pan"] ??= "Please enter a valid PAN (e.g. ABCDE1234F).";
    if (!(edit && !aadhaar.trim()) && !/^\d{12}$/.test(aadhaar.trim())) errors["aadhaar"] ??= "Please enter a valid 12-digit Aadhaar number.";
    if (!bankAccountName.trim()) errors["bankAccountName"] ??= "Please enter the bank account holder's name.";
    if (!bankAccountNumber.trim()) errors["bankAccountNumber"] ??= "Please enter the bank account number.";
    if (!bankIfsc.trim()) errors["bankIfsc"] ??= "Please enter the bank IFSC code.";
    if (Object.keys(errors).length) { setErr(""); setFe(errors); return; }

    setSaving(true);
    setErr("");
    setFe({});
    try {
      const input = {
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
        bankAccountName: bankAccountName.trim(),
        bankAccountNumber: bankAccountNumber.trim(),
        bankIfsc: bankIfsc.trim().toUpperCase(),
      };
      const c = edit ? await updateInvestor(edit.id, input) : await createInvestor(input, linkedCustomerId, confirmSamePerson || !!linkedCustomerId);
      onCreated(c);
    } catch (e) {
      // The phone number, PAN or Aadhaar is on another investor under a different name: nothing is added until
      // the user confirms they are the same person.
      const matches = edit ? null : sameIdentityMatches(e);
      if (matches) {
        toast("Possible duplicate — please confirm before adding");
        openChildModal(<SameInvestorModalContent newName={n} matches={matches} onConfirm={async () => {
          closeModal();
          // An existing borrower: fill the form from them and let staff complete the rest before adding.
          const borrower = matches.find((m) => m.source === "customer");
          if (borrower) await prefillFromBorrower(String(borrower.id));
          else await save(true);
        }} />);
        return;
      }
      const msg = e instanceof Error ? e.message : "Failed to create investor.";
      const field = fieldForMessage(msg, SERVER_FIELDS);
      if (field) fail(field, msg); else setErr(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>{edit ? "Edit Investor" : "Add New Investor"}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow c2">
          <div className={fe.name ? "has-err" : undefined}><label className="f">Full Name *</label><input className="inp" placeholder="e.g. Radha Menon" value={name} onChange={(e) => setName(stripDigits(e.target.value))} /><FieldError msg={fe.name} /></div>
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
          <div className={fe.pan || panLiveError(pan) ? "has-err" : undefined}><label className="f">PAN *</label><input className="inp" placeholder="e.g. ABCDE1234F" maxLength={10} value={pan} onChange={(e) => { setPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")); setFe((cur) => ({ ...cur, pan: "" })); }} /><FieldError msg={fe.pan || panLiveError(pan)} /></div>
          <div className={fe.aadhaar ? "has-err" : undefined}><label className="f">Aadhaar Number *</label><input className="inp" inputMode="numeric" placeholder="12-digit Aadhaar" maxLength={12} value={aadhaar} onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, ""))} /><FieldError msg={fe.aadhaar} /></div>
        </div>
        <div className="frow"><div className={fe.bankAccountName ? "has-err" : undefined}><label className="f">Bank Account Holder Name *</label><input className="inp" placeholder="As per bank records" value={bankAccountName} onChange={(e) => setBankAccountName(e.target.value)} /><FieldError msg={fe.bankAccountName} /></div></div>
        <div className="frow c2">
          <div className={fe.bankAccountNumber ? "has-err" : undefined}><label className="f">Bank Account Number *</label><input className="inp" placeholder="Account number" inputMode="numeric" maxLength={18} value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value.replace(/\D/g, ""))} /><FieldError msg={fe.bankAccountNumber} /></div>
          <div className={fe.bankIfsc ? "has-err" : undefined}><label className="f">Bank IFSC *</label><input className="inp" placeholder="e.g. SBIN0001234" maxLength={11} value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value.toUpperCase())} /><FieldError msg={fe.bankIfsc} /></div>
        </div>
        {err && <div className="notice" style={{ marginTop: 10 }}>{err}</div>}
      </div>
      <div className="ft">        <button className="btn" disabled={saving} onClick={() => save()}>{saving ? (edit ? "Saving…" : "Creating…") : (edit ? "Save Changes" : "Create Investor")}</button>
      </div>
    </>
  );
}
