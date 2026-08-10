"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { createCustomer, uploadFile } from "@/lib/customersApi";
import { listActiveBranches, type BranchView } from "@/lib/branchApi";

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
  const [dob, setDob] = useState("");
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
    if (!/^\d[\d ]{8,}$/.test(p)) { setErr("Please enter a valid mobile number."); return; }
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
        <div className="frow c2">
          <div><label className="f">Full Name *</label><input className="inp" placeholder="e.g. Anil Varma" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="f">Mobile Number *</label><input className="inp" placeholder="10-digit mobile" maxLength={11} value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">Date of Birth</label><input className="inp" type="date" value={dob} onChange={(e) => setDob(e.target.value)} /></div>
          <div><label className="f">Branch *</label>
            <select className="inp" value={branchId} onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Select branch…</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        </div>
        <div className="frow"><div><label className="f">Address</label><input className="inp" placeholder="House / street, town, district" value={addr} onChange={(e) => setAddr(e.target.value)} /></div></div>
        <div className="frow c2">
          <div><label className="f">PAN Number</label><input className="inp" placeholder="ABCDE1234F" maxLength={10} style={{ textTransform: "uppercase" }} value={pan} onChange={(e) => setPan(e.target.value)} /></div>
          <div><label className="f">Aadhaar Number</label><input className="inp" placeholder="12-digit Aadhaar" maxLength={12} value={aadhaar} onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, ""))} /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">Customer Photograph</label><input className="inp" type="file" accept="image/*" onChange={(e) => setPhotoFile(e.target.files?.[0] || null)} /></div>
          <div><label className="f">Identity Proof</label><input className="inp" type="file" accept="image/*,.pdf" onChange={(e) => setIdentityProofFile(e.target.files?.[0] || null)} /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">Address Proof</label><input className="inp" type="file" accept="image/*,.pdf" onChange={(e) => setAddressProofFile(e.target.files?.[0] || null)} /></div>
          <div><label className="f">Supporting KYC Document</label><input className="inp" type="file" accept="image/*,.pdf" onChange={(e) => setKycDocFile(e.target.files?.[0] || null)} /></div>
        </div>
        <label className="f" style={{ marginTop: 6 }}>Nominee Information (optional)</label>
        <div className="frow c2">
          <div><label className="f">Nominee Name</label><input className="inp" placeholder="e.g. Sunitha Varma" value={nomineeName} onChange={(e) => setNomineeName(e.target.value)} /></div>
          <div><label className="f">Relation</label><input className="inp" placeholder="e.g. Spouse" value={nomineeRelation} onChange={(e) => setNomineeRelation(e.target.value)} /></div>
        </div>
        <div className="frow"><div><label className="f">Nominee Mobile Number</label><input className="inp" placeholder="10-digit mobile" maxLength={11} value={nomineePhone} onChange={(e) => setNomineePhone(e.target.value)} /></div></div>
        <div className="notice"><Icon name="shield" /> Stage 1: KYC status is auto-marked &quot;Verified&quot; on registration — no live PAN/Aadhaar verification call happens yet.</div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Registering…" : "Register Customer"}</button>
      </div>
    </>
  );
}
