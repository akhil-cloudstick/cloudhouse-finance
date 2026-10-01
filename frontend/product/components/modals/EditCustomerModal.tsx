"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { Select } from "@/product/components/ui/Select";
import { FileInput } from "@/product/components/ui/FileInput";
import { DatePicker } from "@/product/components/ui/DatePicker";
import { Icon } from "@/product/components/Icon";
import { updateCustomer, uploadFile, type CustomerView } from "@/product/pages/customers/services/customerService";
import { listActiveBranches, type BranchView } from "@/product/pages/branches/services/branchService";
import { useBranding } from "@/product/providers/BrandingProvider";

/* Edit counterpart to RegisterCustomerModal.tsx's create form, wired to the
 * PUT /api/v1/customers/:id update that already existed in customersApi.ts
 * but had no UI calling it. Same field set and validation as create; the
 * only differences are (1) fields are pre-filled from the customer passed
 * in, and (2) the 4 document inputs only replace their stored URL when a
 * new file is chosen — leaving one blank keeps the existing document
 * (matches the backend's full-replace PUT, which would otherwise wipe a
 * URL that isn't resent). Aadhaar is intentionally left blank on open (the
 * backend never returns the plaintext number) — leaving it blank on save
 * keeps the on-file Aadhaar untouched, see service.go's Update. */
export function EditCustomerModalContent({ customer, onSaved }: { customer: CustomerView; onSaved?: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();

  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone);
  const [dob, setDob] = useState(customer.dob);
  const [branches, setBranches] = useState<BranchView[]>([]);
  // Single-branch business: the one branch is preselected and the picker locked.
  const { singleBranch } = useBranding();
  const [branchId, setBranchId] = useState<number | "">(customer.branchId);
  const [addr, setAddr] = useState(customer.address);
  const [pan, setPan] = useState(customer.pan);
  const [aadhaar, setAadhaar] = useState("");
  const [nomineeName, setNomineeName] = useState(customer.nomineeName);
  const [nomineeRelation, setNomineeRelation] = useState(customer.nomineeRelation);
  const [nomineePhone, setNomineePhone] = useState(customer.nomineePhone);

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [identityProofFile, setIdentityProofFile] = useState<File | null>(null);
  const [addressProofFile, setAddressProofFile] = useState<File | null>(null);
  const [kycDocFile, setKycDocFile] = useState<File | null>(null);

  // "Additional Information" — collapsed by default, all optional, same
  // fields RegisterCustomerModal.tsx's own Additional Information section
  // collects, pre-filled here from whatever the customer already has on
  // file (blank for a customer registered before this section existed).
  const [showAdditional, setShowAdditional] = useState(false);
  const [fatherName, setFatherName] = useState(customer.fatherName || "");
  const [age, setAge] = useState(customer.age ? String(customer.age) : "");
  const [district, setDistrict] = useState(customer.district || "");
  const [taluk, setTaluk] = useState(customer.taluk || "");
  const [village, setVillage] = useState(customer.village || "");
  const [place, setPlace] = useState(customer.place || "");
  const [pinCode, setPinCode] = useState(customer.pinCode || "");

  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listActiveBranches()
      .then(setBranches)
      .catch(() => setErr("Could not load branches — try again later."));
  }, []);

  async function save() {
    const n = name.trim();
    const p = phone.trim();
    if (n.length < 3) { setErr("Please enter the customer’s full name."); return; }
    if (p && !/^\d{10}$/.test(p)) { setErr("Please enter a valid 10-digit mobile number."); return; }
    if (!branchId) { setErr("Please select a branch."); return; }

    setSaving(true);
    setErr("");
    try {
      const [photoUrl, identityProofUrl, addressProofUrl, kycDocumentUrl] = await Promise.all([
        photoFile ? uploadFile(photoFile) : Promise.resolve(customer.photoUrl),
        identityProofFile ? uploadFile(identityProofFile) : Promise.resolve(customer.identityProofUrl),
        addressProofFile ? uploadFile(addressProofFile) : Promise.resolve(customer.addressProofUrl),
        kycDocFile ? uploadFile(kycDocFile) : Promise.resolve(customer.kycDocumentUrl),
      ]);

      await updateCustomer(customer.id, {
        name: n,
        phone: p,
        dob,
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
        fatherName: fatherName.trim(),
        district: district.trim(),
        taluk: taluk.trim(),
        village: village.trim(),
        place: place.trim(),
        pinCode: pinCode.trim(),
        ...(age.trim() ? { age: Number(age) } : {}),
      });

      onSaved?.();
      closeModal();
      toast(`${n} updated.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to update customer.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Edit Customer</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <label className="f">Personal Details</label>
        <div className="frow c3">
          <div><label className="f">Full Name *</label><input className="inp" placeholder="e.g. Anil Varma" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="f">Mobile Number</label><input className="inp" inputMode="numeric" placeholder="10-digit mobile" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} /></div>
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
          <div><label className="f">Aadhaar Number</label><input className="inp" placeholder="Leave blank to keep on-file Aadhaar" maxLength={12} value={aadhaar} onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, ""))} /></div>
        </div>

        <label className="f" style={{ marginTop: 6 }}>Documents</label>
        <div className="frow c3">
          <div><label className="f">Customer Photograph {customer.photoUrl && <a href={customer.photoUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 400 }}>(view current)</a>}</label><FileInput value={photoFile} onChange={setPhotoFile} accept="image/*" placeholder="Leave blank to keep current photo" /></div>
          <div><label className="f">Identity Proof {customer.identityProofUrl && <a href={customer.identityProofUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 400 }}>(view current)</a>}</label><FileInput value={identityProofFile} onChange={setIdentityProofFile} accept="image/*,.pdf" placeholder="Leave blank to keep current document" /></div>
          <div><label className="f">Address Proof {customer.addressProofUrl && <a href={customer.addressProofUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 400 }}>(view current)</a>}</label><FileInput value={addressProofFile} onChange={setAddressProofFile} accept="image/*,.pdf" placeholder="Leave blank to keep current document" /></div>
        </div>
        <div className="frow c3">
          <div><label className="f">Supporting KYC Document {customer.kycDocumentUrl && <a href={customer.kycDocumentUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 400 }}>(view current)</a>}</label><FileInput value={kycDocFile} onChange={setKycDocFile} accept="image/*,.pdf" placeholder="Leave blank to keep current document" /></div>
        </div>

        <label className="f" style={{ marginTop: 6 }}>Nominee Information (optional)</label>
        <div className="frow c3">
          <div><label className="f">Nominee Name</label><input className="inp" placeholder="e.g. Sunitha Varma" value={nomineeName} onChange={(e) => setNomineeName(e.target.value)} /></div>
          <div><label className="f">Relation</label><input className="inp" placeholder="e.g. Spouse" value={nomineeRelation} onChange={(e) => setNomineeRelation(e.target.value)} /></div>
          <div><label className="f">Nominee Mobile Number</label><input className="inp" placeholder="10-digit mobile" inputMode="numeric" maxLength={10} value={nomineePhone} onChange={(e) => setNomineePhone(e.target.value.replace(/\D/g, ""))} /></div>
        </div>

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
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Save Changes"}</button>
      </div>
    </>
  );
}
