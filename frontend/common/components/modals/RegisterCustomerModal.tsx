"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { Select } from "@/common/components/ui/Select";
import { FileInput } from "@/common/components/ui/FileInput";
import { Icon } from "@/common/components/Icon";
import { createCustomer, uploadFile } from "@/modules/customers/services/customerService";
import { listActiveBranches, type BranchView } from "@/modules/branches/services/branchService";

/* Ported from legacy/app.js's `openCustomerModal()` / `saveCustomer()`. Now
 * calls the Go backend (`POST /api/v1/customers`) instead of writing to the
 * localStorage mock store — see the Customer Module stage-1 plan. Every
 * field the plan calls for is collected here: personal/KYC details, PAN,
 * Aadhaar (encrypted server-side, never stored/returned in plaintext),
 * identity/address proof, supporting KYC docs, and nominee info. KYC/PAN/
 * Aadhaar status all come back "Verified" immediately — no live Setu/
 * DigiLocker call happens yet (stage-1 stub, see backend/internal/customer). */
export function RegisterCustomerModalContent({ onSaved }: { onSaved?: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [branches, setBranches] = useState<BranchView[]>([]);
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

  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listActiveBranches()
      .then((list) => { setBranches(list); if (list.length) setBranchId((cur) => cur || list[0].id); })
      .catch(() => setErr("Could not load branches — try again later."));
  }, []);

  async function save() {
    const n = name.trim();
    const p = phone.trim();
    if (n.length < 3) { setErr("Please enter the customer’s full name."); return; }
    // Exactly 10 digits — the input is digit-filtered and capped at 10, and
    // this matches what the mobile register screen enforces. The old
    // /^\d[\d ]{8,}$/ let 9-digit and space-separated numbers through.
    if (p && !/^\d{10}$/.test(p)) { setErr("Please enter a valid 10-digit mobile number."); return; }
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
      });

      onSaved?.();
      closeModal();
      toast(`${n} registered — ${c.code} · KYC auto-verified (stage 1 — no live verification yet)`);
      location.hash = "customer/" + c.id;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to register customer.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Register Customer</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <label className="f">Personal Details</label>
        <div className="frow c3">
          <div><label className="f">Full Name *</label><input className="inp" placeholder="e.g. Anil Varma" value={name} onChange={(e) => setName(e.target.value)} /></div>
          {/* Digit-filtered on input like Aadhaar below (and like the mobile
              app's register screen), so letters/spaces/punctuation can't be
              typed at all rather than being caught only on save. */}
          <div><label className="f">Mobile Number</label><input className="inp" inputMode="numeric" placeholder="10-digit mobile" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} /></div>
          <div><label className="f">Branch *</label>
            <Select
              value={branchId === "" ? "" : String(branchId)}
              onChange={(v) => setBranchId(v ? Number(v) : "")}
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
          <div><label className="f">Customer Photograph</label><FileInput value={photoFile} onChange={setPhotoFile} accept="image/*" /></div>
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
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Registering…" : "Register Customer"}</button>
      </div>
    </>
  );
}
