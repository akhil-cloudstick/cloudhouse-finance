"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { Select } from "@/common/components/ui/Select";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { createCustomer, type CustomerView } from "@/modules/customers/services/customerService";
import { listActiveBranches, type BranchView } from "@/modules/branches/services/branchService";

/* Inline "+ Add new customer" flow reached from the Personal Loan creation
 * picker (NewPersonalLoanModal.tsx's SearchableSelect, via its onCreateNew
 * prop). This is a separate, smaller form than the full Customers & KYC
 * page's RegisterCustomerModal.tsx — it collects only the core fields
 * CreateInput needs (name/phone/branch) plus the personal-loan-specific
 * fields (backend/internal/customer/model.go: FatherName/District/Taluk/
 * Village/Place/PinCode/Age), always shown here since this modal is only ever
 * reachable from the personal-loan flow. Photo/proof uploads and nominee
 * details are deliberately left out — staff can fill those in later from
 * the full Customers page if needed; they aren't required to disburse a
 * personal loan.
 *
 * onCreated hands the freshly created customer straight back to the caller
 * so it can be selected immediately in the picker without a re-search. */
export function CreateCustomerModalContent({ onCreated }: { onCreated: (customer: CustomerView) => void }) {
  const { closeModal } = useModal();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [branches, setBranches] = useState<BranchView[]>([]);
  const [branchId, setBranchId] = useState<number | "">("");
  const [address, setAddress] = useState("");
  const [fatherName, setFatherName] = useState("");
  const [district, setDistrict] = useState("");
  const [taluk, setTaluk] = useState("");
  const [village, setVillage] = useState("");
  const [place, setPlace] = useState("");
  const [pinCode, setPinCode] = useState("");
  const [age, setAge] = useState("");
  const [dob, setDob] = useState("");
  const [aadhaar, setAadhaar] = useState("");

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
    if (n.length < 3) { setErr("Please enter the customer's full name."); return; }
    if (!/^\d{10}$/.test(p)) { setErr("Please enter a valid 10-digit mobile number."); return; }
    if (!branchId) { setErr("Please select a branch."); return; }
    if (!fatherName.trim()) { setErr("Please enter the father's name."); return; }
    if (!district.trim()) { setErr("Please enter the district."); return; }
    if (!/^\d{6}$/.test(pinCode.trim())) { setErr("Please enter a valid 6-digit pin code."); return; }
    const ageNum = age.trim() ? Number(age) : NaN;
    if (!age.trim() || !Number.isInteger(ageNum) || ageNum <= 0) { setErr("Please enter a valid age."); return; }
    if (!/^\d{12}$/.test(aadhaar.trim())) { setErr("Please enter a valid 12-digit Aadhaar number."); return; }

    setSaving(true);
    setErr("");
    try {
      const c = await createCustomer({
        name: n,
        phone: p,
        dob,
        address: address.trim(),
        branchId: Number(branchId),
        photoUrl: "",
        identityProofUrl: "",
        addressProofUrl: "",
        kycDocumentUrl: "",
        pan: "",
        aadhaar: aadhaar.trim(),
        nomineeName: "",
        nomineeRelation: "",
        nomineePhone: "",
        fatherName: fatherName.trim(),
        district: district.trim(),
        taluk: taluk.trim(),
        village: village.trim(),
        place: place.trim(),
        pinCode: pinCode.trim(),
        age: ageNum,
      });
      onCreated(c);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create customer.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Add New Customer</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow c2">
          <div><label className="f">Full Name *</label><input className="inp" placeholder="e.g. Anil Varma" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="f">Mobile Number *</label><input className="inp" inputMode="numeric" placeholder="10-digit mobile" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">Father's Name *</label><input className="inp" placeholder="e.g. Ravi Varma" value={fatherName} onChange={(e) => setFatherName(e.target.value)} /></div>
          <div><label className="f">Age *</label><input className="inp" type="number" min={1} placeholder="e.g. 35" value={age} onChange={(e) => setAge(e.target.value)} /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">Date of Birth</label><DatePicker value={dob} onChange={setDob} placeholder="Select date of birth…" max={new Date().toISOString().slice(0, 10)} /></div>
          <div><label className="f">Branch *</label>
            <Select
              value={branchId === "" ? "" : String(branchId)}
              onChange={(v) => setBranchId(v ? Number(v) : "")}
              options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
              placeholder="Select branch…"
            />
          </div>
        </div>
        <div className="frow"><div><label className="f">Address</label><input className="inp" placeholder="House / street" value={address} onChange={(e) => setAddress(e.target.value)} /></div></div>
        <div className="frow c2">
          <div><label className="f">District *</label><input className="inp" placeholder="e.g. Thrissur" value={district} onChange={(e) => setDistrict(e.target.value)} /></div>
          <div><label className="f">Taluk</label><input className="inp" placeholder="e.g. Kozhikode" value={taluk} onChange={(e) => setTaluk(e.target.value)} /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">Village</label><input className="inp" placeholder="e.g. Feroke" value={village} onChange={(e) => setVillage(e.target.value)} /></div>
          <div><label className="f">Place</label><input className="inp" placeholder="e.g. Feroke" value={place} onChange={(e) => setPlace(e.target.value)} /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">Pin Code *</label><input className="inp" inputMode="numeric" placeholder="6-digit pin code" maxLength={6} value={pinCode} onChange={(e) => setPinCode(e.target.value.replace(/\D/g, ""))} /></div>
          <div><label className="f">Aadhaar Number *</label><input className="inp" placeholder="12-digit Aadhaar" maxLength={12} value={aadhaar} onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, ""))} /></div>
        </div>
        {err && <div className="notice" style={{ marginTop: 10 }}>{err}</div>}
      </div>
      <div className="ft">
        <button className="btn plain" style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase" }} onClick={closeModal}>Cancel</button>
        <button className="btn" disabled={saving} onClick={save}>{saving ? "Creating…" : "Create Customer"}</button>
      </div>
    </>
  );
}
