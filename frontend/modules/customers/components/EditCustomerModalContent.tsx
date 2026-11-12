"use client";

import { panLiveError, PAN_RE, AADHAAR_RE, PAN_MESSAGE, AADHAAR_MESSAGE, stripDigits } from "@/common/utils/kyc";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ageFromDob } from "@/common/utils/format";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Select } from "@/common/components/ui/Select";
import { FileInput } from "@/common/components/ui/FileInput";
import { SafeImage } from "@/common/components/ui/SafeImage";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { Icon } from "@/common/components/Icon";
import { updateCustomer, uploadFile } from "@/modules/customers/services/customerService";
import { type CustomerView } from "@/modules/customers/types/customer-types";
import { listActiveBranches } from "@/modules/branches/services/branchService";
import { type BranchView } from "@/modules/branches/types/branch-types";
import { useBranding } from "@/common/providers/BrandingProvider";
import { useLockedBranchId, useShowBranch } from "@/common/hooks/use-branch-switch";
import { singleFlight } from "@/common/utils/singleFlight";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";

// Which field a server message is about, by its words (first match wins).
const SERVER_FIELDS: Record<string, RegExp> = {
  name: /name/i, phone: /phone|mobile/i, branch: /branch/i, aadhaar: /aadhaar/i, pan: /\bpan\b/i,
};

type EditCustomerModalContentProps = { customer: CustomerView; onSaved?: () => void };

/* The file already on record, shown under its upload field so staff can see what is there before replacing it. */
function CurrentDoc({ url, onRemove }: { url: string; onRemove: () => void }) {
  const [viewing, setViewing] = useState(false);
  const isPdf = /\.pdf(\?|$)/i.test(url);
  const box = { width: 44, height: 44, borderRadius: 6, border: "1px solid var(--line)", cursor: "pointer", objectFit: "cover" as const };
  return (
    <div style={{ position: "relative", display: "inline-block", marginTop: 8 }}>
      {isPdf ? (
        <button type="button" title="View document" onClick={() => setViewing(true)} style={{ ...box, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, background: "var(--card, #fff)", padding: 0, color: "inherit" }}>PDF</button>
      ) : (
        <SafeImage src={url} alt="Current file" title="View photo" onClick={() => setViewing(true)} style={{ display: "block", ...box }} />
      )}
      {/* Local overlay (not openModal): swapping the modal would unmount this form and lose unsaved edits. */}
      {viewing && createPortal(
        <div
          onClick={() => setViewing(false)}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setViewing(false); } }}
          role="dialog"
          aria-modal="true"
          style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", maxWidth: "min(92vw, 900px)", maxHeight: "88vh", background: "var(--bg)", borderRadius: 12, padding: 8, boxShadow: "0 24px 60px -18px rgba(0,0,0,.5)" }}>
            <button type="button" autoFocus aria-label="Close" onClick={() => setViewing(false)} style={{ position: "absolute", top: -12, right: -12, width: 28, height: 28, borderRadius: "50%", border: "1px solid var(--line)", background: "var(--bg)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
            {isPdf
              ? <iframe src={url} title="Document" style={{ display: "block", width: "min(86vw, 860px)", height: "82vh", border: 0, borderRadius: 8 }} />
              : <SafeImage src={url} alt="Document" style={{ display: "block", maxWidth: "100%", maxHeight: "84vh", objectFit: "contain", borderRadius: 8 }} />}
          </div>
        </div>,
        document.body
      )}
      <button
        type="button"
        title="Remove current file"
        aria-label="Remove current file"
        onClick={onRemove}
        style={{ position: "absolute", top: -7, right: -7, width: 20, height: 20, borderRadius: "50%", border: "1px solid var(--line)", background: "var(--card, #fff)", color: "var(--red)", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
      >×</button>
    </div>
  );
}

/* Thumbnail of a just-chosen (not yet saved) image, so staff can see the replacement before saving. */
function NewFilePreview({ file }: { file: File }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setSrc(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  if (!src || !file.type.startsWith("image/")) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="New photograph" title="New photograph (not saved yet)" style={{ display: "block", marginTop: 8, width: 64, height: 64, borderRadius: 8, border: "1px solid var(--line)", objectFit: "cover" }} />;
}

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
export function EditCustomerModalContent({ customer, onSaved }: EditCustomerModalContentProps) {
  const { closeModal } = useModal();
  const toast = useToast();

  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone);
  const [dob, setDob] = useState(customer.dob);
  const [branches, setBranches] = useState<BranchView[]>([]);
  // Single-branch business: the one branch is preselected and the picker locked.
  const { singleBranch } = useBranding();
  // Single-branch plan: no branch is ever shown — the field is not rendered.
  const showBranch = useShowBranch();
  // Locked (and defaulted) to the global branch selection when one is
  // active, the same way a single-branch business locks it.
  const lockedBranchId = useLockedBranchId();
  const branchLocked = singleBranch || lockedBranchId != null;
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
  // Stored documents the user has × -removed; they are saved as blank unless a new file is chosen.
  const [removed, setRemoved] = useState({ photo: false, identity: false, address: false, kyc: false });
  const drop = (k: keyof typeof removed) => setRemoved((r) => ({ ...r, [k]: true }));

  // "Additional Information" — collapsed by default, all optional, same
  // fields RegisterCustomerModal.tsx's own Additional Information section
  // collects, pre-filled here from whatever the customer already has on
  // file (blank for a customer registered before this section existed).
  const [showAdditional, setShowAdditional] = useState(false);
  const [fatherName, setFatherName] = useState(customer.fatherName || "");
  const [district, setDistrict] = useState(customer.district || "");
  const [taluk, setTaluk] = useState(customer.taluk || "");
  const [village, setVillage] = useState(customer.village || "");
  const [place, setPlace] = useState(customer.place || "");
  const [pinCode, setPinCode] = useState(customer.pinCode || "");

  const [err, setErr] = useState("");
  // Validation messages, each shown under the field it is about; `err` keeps the ones that fit no field.
  const [fe, setFe] = useState<Record<string, string>>({});
  const fail = (field: string, msg: string) => { setErr(""); setFe({ [field]: msg }); };
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listActiveBranches()
      .then((list) => {
        setBranches(list);
        // Single-branch plan: the field is hidden, so a customer saved
        // without a branch falls back to the only branch and still validates.
        if (singleBranch && list.length) setBranchId((cur) => cur || list[0].id);
      })
      .catch(() => setErr("Could not load branches — try again later."));
  }, [singleBranch]);

  async function save() { return singleFlight("modal:editcustomer:save", async () => {
    const n = name.trim();
    const p = phone.trim();
    // Every problem is shown at once, each under its own field. Aadhaar stays blank to keep the one on file.
    const errors: Record<string, string> = {};
    if (n.length < 3) errors.name = "Please enter the customer’s full name.";
    if (!p) errors.phone = "Please enter the customer’s mobile number.";
    else if (!/^\d{10}$/.test(p)) errors.phone = "Please enter a valid 10-digit mobile number.";
    if (!branchId) errors.branch = "Please select a branch.";
    if (pan.trim() && !PAN_RE.test(pan.trim().toUpperCase())) errors.pan = PAN_MESSAGE;
    if (aadhaar.trim() && !AADHAAR_RE.test(aadhaar.trim())) errors.aadhaar = AADHAAR_MESSAGE;
    if (Object.keys(errors).length) { setErr(""); setFe(errors); return; }

    setSaving(true);
    setErr("");
    setFe({});
    try {
      const [photoUrl, identityProofUrl, addressProofUrl, kycDocumentUrl] = await Promise.all([
        photoFile ? uploadFile(photoFile) : Promise.resolve(removed.photo ? "" : customer.photoUrl),
        identityProofFile ? uploadFile(identityProofFile) : Promise.resolve(removed.identity ? "" : customer.identityProofUrl),
        addressProofFile ? uploadFile(addressProofFile) : Promise.resolve(removed.address ? "" : customer.addressProofUrl),
        kycDocFile ? uploadFile(kycDocFile) : Promise.resolve(removed.kyc ? "" : customer.kycDocumentUrl),
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
        ...(ageFromDob(dob) != null ? { age: ageFromDob(dob)! } : {}),
      });

      onSaved?.();
      closeModal();
      toast(`${n} updated.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to update customer.";
      const field = fieldForMessage(msg, SERVER_FIELDS);
      if (field) fail(field, msg); else setErr(msg);
    } finally {
      setSaving(false);
    }
  }); }

  return (
    <>
      <div className="hd"><h3>Edit Customer</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <label className="f">Personal Details</label>
        <div className="frow c3">
          <div className={fe.name ? "has-err" : undefined}><label className="f">Full Name *</label><input className="inp" placeholder="e.g. Anil Varma" value={name} onChange={(e) => setName(stripDigits(e.target.value))} /><FieldError msg={fe.name} /></div>
          <div className={fe.phone ? "has-err" : undefined}><label className="f">Mobile Number *</label><input className="inp" inputMode="numeric" placeholder="10-digit mobile" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} /><FieldError msg={fe.phone} /></div>
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
          <div><label className="f">Date of Birth</label><DatePicker value={dob} onChange={setDob} placeholder="Select date of birth…" max={new Date().toISOString().slice(0, 10)} /></div>
          <div><label className="f">Age</label><input className="inp" readOnly tabIndex={-1} placeholder="Auto from date of birth" value={ageFromDob(dob) ?? ""} style={{ background: "var(--bg-soft, #f6f6f8)" }} /></div>
          <div><label className="f">Address</label><input className="inp" placeholder="House / street, town, district" value={addr} onChange={(e) => setAddr(e.target.value)} /></div>
          <div className={fe.pan || panLiveError(pan) ? "has-err" : undefined}><label className="f">PAN Number</label><input className="inp" placeholder="ABCDE1234F" maxLength={10} style={{ textTransform: "uppercase" }} value={pan} onChange={(e) => setPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} /><FieldError msg={fe.pan || panLiveError(pan)} /></div>
          <div className={fe.aadhaar ? "has-err" : undefined}><label className="f">Aadhaar Number</label><input className="inp" placeholder="Leave blank to keep on-file Aadhaar" maxLength={12} value={aadhaar} onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, ""))} /><FieldError msg={fe.aadhaar} /></div>
        </div>

        <label className="f" style={{ marginTop: 6 }}>Documents</label>
        <div className="frow c3">
          <div><label className="f">Customer Photograph</label><FileInput value={photoFile} onChange={setPhotoFile} accept="image/*" placeholder="Leave blank to keep current photo" camera />{photoFile && <NewFilePreview file={photoFile} />}{customer.photoUrl && !photoFile && !removed.photo && <CurrentDoc url={customer.photoUrl} onRemove={() => drop("photo")} />}</div>
          <div><label className="f">Identity Proof</label><FileInput value={identityProofFile} onChange={setIdentityProofFile} accept="image/*,.pdf" placeholder="Leave blank to keep current document" camera />{customer.identityProofUrl && !identityProofFile && !removed.identity && <CurrentDoc url={customer.identityProofUrl} onRemove={() => drop("identity")} />}</div>
          <div><label className="f">Address Proof</label><FileInput value={addressProofFile} onChange={setAddressProofFile} accept="image/*,.pdf" placeholder="Leave blank to keep current document" camera />{customer.addressProofUrl && !addressProofFile && !removed.address && <CurrentDoc url={customer.addressProofUrl} onRemove={() => drop("address")} />}</div>
        </div>
        <div className="frow c3">
          <div><label className="f">Supporting KYC Document</label><FileInput value={kycDocFile} onChange={setKycDocFile} accept="image/*,.pdf" placeholder="Leave blank to keep current document" camera />{customer.kycDocumentUrl && !kycDocFile && !removed.kyc && <CurrentDoc url={customer.kycDocumentUrl} onRemove={() => drop("kyc")} />}</div>
        </div>

        <label className="f" style={{ marginTop: 6 }}>Nominee Information (optional)</label>
        <div className="frow c3">
          <div><label className="f">Nominee Name</label><input className="inp" placeholder="e.g. Sunitha Varma" value={nomineeName} onChange={(e) => setNomineeName(stripDigits(e.target.value))} /></div>
          <div><label className="f">Relation</label><input className="inp" placeholder="e.g. Spouse" value={nomineeRelation} onChange={(e) => setNomineeRelation(stripDigits(e.target.value))} /></div>
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
        <div className={`addl-wrap${showAdditional ? " open" : ""}`}>
          <div className="addl-inner">
            <div className="frow c3" style={{ marginTop: 14 }}>
              <div><label className="f">Guardian Name</label><input className="inp" placeholder="e.g. Ravi Varma" value={fatherName} onChange={(e) => setFatherName(stripDigits(e.target.value))} /></div>
              <div><label className="f">District</label><input className="inp" placeholder="e.g. Thrissur" value={district} onChange={(e) => setDistrict(e.target.value)} /></div>
              <div><label className="f">Taluk</label><input className="inp" placeholder="e.g. Kozhikode" value={taluk} onChange={(e) => setTaluk(e.target.value)} /></div>
            </div>
            <div className="frow c3">
              <div><label className="f">Village</label><input className="inp" placeholder="e.g. Feroke" value={village} onChange={(e) => setVillage(e.target.value)} /></div>
              <div><label className="f">Place</label><input className="inp" placeholder="e.g. Feroke" value={place} onChange={(e) => setPlace(e.target.value)} /></div>
              <div><label className="f">Pin Code</label><input className="inp" inputMode="numeric" placeholder="6-digit pin code" maxLength={6} value={pinCode} onChange={(e) => setPinCode(e.target.value.replace(/\D/g, ""))} /></div>
            </div>
          </div>
        </div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Save Changes"}</button>
      </div>
    </>
  );
}
