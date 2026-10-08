"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { Select } from "@/product/components/ui/Select";
import { FileInput } from "@/product/components/ui/FileInput";
import { DatePicker } from "@/product/components/ui/DatePicker";
import { Icon } from "@/product/components/Icon";
import { createCustomer, uploadFile, type CustomerView } from "@/product/pages/customers/services/customerService";
import { listActiveBranches, type BranchView } from "@/product/pages/branches/services/branchService";
import { useBranding } from "@/product/providers/BrandingProvider";
import { navigate } from "@/product/services/appRoutes";
import { useCanOpenRoute } from "@/product/hooks/useCanOpenRoute";
import { singleFlight } from "@/product/utils/singleFlight";

/* Ported from legacy/app.js's `openCustomerModal()` / `saveCustomer()`. Now
 * calls the Go backend (`POST /api/v1/customers`) instead of writing to the
 * localStorage mock store — see the Customer Module stage-1 plan. Every
 * field the plan calls for is collected here: personal/KYC details, PAN,
 * Aadhaar (encrypted server-side, never stored/returned in plaintext),
 * identity/address proof, supporting KYC docs, and nominee info. KYC/PAN/
 * Aadhaar status all come back "Verified" immediately — no live Setu/
 * DigiLocker call happens yet (stage-1 stub, see backend/internal/customer).
 *
 * Canonical customer-registration modal — also used by the personal-loan
 * "+ Add new customer" flow (NewPersonalLoanModal.tsx) via `onCreated`,
 * which used to have its own near-duplicate form (CreateCustomerModal.tsx).
 * The personal-loan-only fields it collected (Father's Name/Age/DOB/
 * District/Taluk/Village/Place/Pin Code) live in the collapsed "Additional
 * Information" section below — optional everywhere, including here. */
export function RegisterCustomerModalContent({
  onSaved,
  onCreated,
}: {
  // Full standalone "Register Customer" flow (Customers.tsx/Dashboard.tsx):
  // closes the modal itself, toasts, and navigates to the new customer.
  onSaved?: () => void;
  // Inline flow (NewPersonalLoanModal.tsx): hands the created customer back
  // to the caller instead — the caller stays on its own form and decides
  // what happens next, so this modal must not close itself or navigate.
  onCreated?: (customer: CustomerView) => void;
}) {
  const { closeModal } = useModal();
  const canOpen = useCanOpenRoute();
  const toast = useToast();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [branches, setBranches] = useState<BranchView[]>([]);
  // Single-branch business: the one branch is preselected and the picker locked.
  const { singleBranch } = useBranding();
  const [branchId, setBranchId] = useState<number | "">("");
  const [addr, setAddr] = useState("");
  const [pan, setPan] = useState("");
  const [aadhaar, setAadhaar] = useState("");
  const [nomineeName, setNomineeName] = useState("");
  const [nomineeRelation, setNomineeRelation] = useState("");
  const [nomineePhone, setNomineePhone] = useState("");

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [identityProofFile, setIdentityProofFile] = useState<File | null>(null);
  const [addressProofFile, setAddressProofFile] = useState<File | null>(null);
  const [kycDocFile, setKycDocFile] = useState<File | null>(null);

  // "Additional Information" — collapsed by default, all optional. Ported
  // from the now-retired CreateCustomerModal.tsx (personal-loan-only form).
  const [showAdditional, setShowAdditional] = useState(false);
  const [fatherName, setFatherName] = useState("");
  const [age, setAge] = useState("");
  const [dob, setDob] = useState("");
  const [district, setDistrict] = useState("");
  const [taluk, setTaluk] = useState("");
  const [village, setVillage] = useState("");
  const [place, setPlace] = useState("");
  const [pinCode, setPinCode] = useState("");

  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listActiveBranches()
      .then((list) => { setBranches(list); if (list.length) setBranchId((cur) => cur || list[0].id); })
      .catch(() => setErr("Could not load branches — try again later."));
  }, []);

  async function save() { return singleFlight("modal:registercustomer:save", async () => {
    const n = name.trim();
    const p = phone.trim();
    if (n.length < 3) { setErr("Please enter the customer’s full name."); return; }
    // Exactly 10 digits — the input is digit-filtered and capped at 10, and
    // this matches what the mobile register screen enforces. The old
    // /^\d[\d ]{8,}$/ let 9-digit and space-separated numbers through.
    if (!p) { setErr("Please enter the customer’s mobile number."); return; }
    if (!/^\d{10}$/.test(p)) { setErr("Please enter a valid 10-digit mobile number."); return; }
    if (!branchId) { setErr("Please select a branch."); return; }

    setSaving(true);
    setErr("");
    try {
      const [photoUrl, identityProofUrl, addressProofUrl, kycDocumentUrl] = await Promise.all([
        photoFile ? uploadFile(photoFile) : Promise.resolve(""),
        identityProofFile ? uploadFile(identityProofFile) : Promise.resolve(""),
        addressProofFile ? uploadFile(addressProofFile) : Promise.resolve(""),
        kycDocFile ? uploadFile(kycDocFile) : Promise.resolve(""),
      ]);

      const c = await createCustomer({
        name: n,
        phone: p,
        ...(dob ? { dob } : {}),
        address: addr.trim(),
        branchId: Number(branchId),
        photoUrl,
        identityProofUrl,
        addressProofUrl,
        kycDocumentUrl,
        pan: pan.trim().toUpperCase(),
        aadhaar: aadhaar.trim(),
        nomineeName: nomineeName.trim(),
        nomineeRelation: nomineeRelation.trim(),
        nomineePhone: nomineePhone.trim(),
        ...(fatherName.trim() ? { fatherName: fatherName.trim() } : {}),
        ...(district.trim() ? { district: district.trim() } : {}),
        ...(taluk.trim() ? { taluk: taluk.trim() } : {}),
        ...(village.trim() ? { village: village.trim() } : {}),
        ...(place.trim() ? { place: place.trim() } : {}),
        ...(pinCode.trim() ? { pinCode: pinCode.trim() } : {}),
        ...(age.trim() ? { age: Number(age) } : {}),
      });

      if (onCreated) {
        onCreated(c);
        return;
      }
      onSaved?.();
      closeModal();
      toast(`${n} registered — ${c.code} · KYC auto-verified (stage 1 — no live verification yet)`);
      // Open the new record only for a role that may view customers (a
      // create-only role stays put rather than hitting the refusal toast).
      if (canOpen("customer")) navigate("customer/" + c.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to register customer.");
    } finally {
      setSaving(false);
    }
  }); }

  return (
    <>
      <div className="hd"><h3>Register Customer</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <label className="f">Personal Details</label>
        <div className="frow c3">
          <div><label className="f">Full Name *</label><input className="inp" placeholder="e.g. Anil Varma" value={name} onChange={(e) => setName(e.target.value)} /></div>
          {/* Digit-filtered on input like Aadhaar below (and like the mobile
              app's register screen), so letters/spaces/punctuation can't be
              typed at all rather than being caught only on save. */}
          <div><label className="f">Mobile Number *</label><input className="inp" inputMode="numeric" placeholder="10-digit mobile" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} /></div>
          <div><label className="f">Branch *</label>
            <Select
              value={branchId === "" ? "" : String(branchId)}
              onChange={(v) => setBranchId(v ? Number(v) : "")}
              disabled={singleBranch}
              options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
              placeholder="Select branch…"
            />
          </div>
        </div>
        <div className="frow c3">
          <div><label className="f">Address</label><input className="inp" placeholder="House / street, town, district" value={addr} onChange={(e) => setAddr(e.target.value)} /></div>
          <div><label className="f">PAN Number</label><input className="inp" placeholder="ABCDE1234F" maxLength={10} style={{ textTransform: "uppercase" }} value={pan} onChange={(e) => setPan(e.target.value)} /></div>
          <div><label className="f">Aadhaar Number</label><input className="inp" placeholder="12-digit Aadhaar" maxLength={12} value={aadhaar} onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, ""))} /></div>
        </div>

        <label className="f" style={{ marginTop: 6 }}>Documents</label>
        <div className="frow c3">
          <div><label className="f">Customer Photograph</label><FileInput value={photoFile} onChange={setPhotoFile} accept="image/*" camera /></div>
          <div><label className="f">Identity Proof</label><FileInput value={identityProofFile} onChange={setIdentityProofFile} accept="image/*,.pdf" /></div>
          <div><label className="f">Address Proof</label><FileInput value={addressProofFile} onChange={setAddressProofFile} accept="image/*,.pdf" /></div>
        </div>
        <div className="frow c3">
          <div><label className="f">Supporting KYC Document</label><FileInput value={kycDocFile} onChange={setKycDocFile} accept="image/*,.pdf" /></div>
        </div>

        <label className="f" style={{ marginTop: 6 }}>Nominee (optional)</label>
        <div className="frow c3">
          <div><label className="f">Nominee Name</label><input className="inp" placeholder="e.g. Sunitha Varma" value={nomineeName} onChange={(e) => setNomineeName(e.target.value)} /></div>
          <div><label className="f">Relation</label><input className="inp" placeholder="e.g. Spouse" value={nomineeRelation} onChange={(e) => setNomineeRelation(e.target.value)} /></div>
          <div><label className="f">Nominee Mobile Number</label><input className="inp" placeholder="10-digit mobile" inputMode="numeric" maxLength={10} value={nomineePhone} onChange={(e) => setNomineePhone(e.target.value.replace(/\D/g, ""))} /></div>
        </div>
        {/* Collapsed by default — the personal-loan-only fields this used to
            be CreateCustomerModal.tsx's own dedicated form for, kept
            optional here since general (gold-loan) registration never
            required them. */}
        <button
          type="button"
          className="btn plain sm"
          style={{ marginTop: 6, display: "inline-flex", alignItems: "center", gap: 6 }}
          onClick={() => setShowAdditional((v) => !v)}
          aria-expanded={showAdditional}
        >
          <Icon name="chevronDown" style={{ transform: showAdditional ? "rotate(180deg)" : undefined, transition: "transform .15s" }} />
          Additional Information
        </button>
        {showAdditional && (
          <>
            <div className="frow c3" style={{ marginTop: 14 }}>
              <div><label className="f">Father&apos;s Name</label><input className="inp" placeholder="e.g. Ravi Varma" value={fatherName} onChange={(e) => setFatherName(e.target.value)} /></div>
              <div><label className="f">Age</label><input className="inp" type="number" min={1} placeholder="e.g. 35" value={age} onChange={(e) => setAge(e.target.value)} /></div>
              <div><label className="f">Date of Birth</label><DatePicker value={dob} onChange={setDob} placeholder="Select date of birth…" max={new Date().toISOString().slice(0, 10)} /></div>
            </div>
            <div className="frow c3">
              <div><label className="f">District</label><input className="inp" placeholder="e.g. Thrissur" value={district} onChange={(e) => setDistrict(e.target.value)} /></div>
              <div><label className="f">Taluk</label><input className="inp" placeholder="e.g. Kozhikode" value={taluk} onChange={(e) => setTaluk(e.target.value)} /></div>
              <div><label className="f">Village</label><input className="inp" placeholder="e.g. Feroke" value={village} onChange={(e) => setVillage(e.target.value)} /></div>
            </div>
            <div className="frow c3">
              <div><label className="f">Place</label><input className="inp" placeholder="e.g. Feroke" value={place} onChange={(e) => setPlace(e.target.value)} /></div>
              <div><label className="f">Pin Code</label><input className="inp" inputMode="numeric" placeholder="6-digit pin code" maxLength={6} value={pinCode} onChange={(e) => setPinCode(e.target.value.replace(/\D/g, ""))} /></div>
            </div>
          </>
        )}
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Registering…" : "Register Customer"}</button>
      </div>
    </>
  );
}
