"use client";

import { useState } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { Icon } from "@/product/components/Icon";
import { ApiError } from "@/product/services/httpClient";
import { createBankFull, updateBank, type BackendBank } from "@/product/pages/banks/services/bankService";

const IFSC_RE = /^[A-Za-z0-9]*$/;
const PHONE_RE = /^\d{10}$/;

/* Add/Edit Bank form, mirroring BranchModal.tsx's pattern exactly — calls
 * the Go backend (POST/PUT /api/v1/banks) directly. */
export function BankModalContent({ bank: b, onSaved }: { bank?: BackendBank; onSaved: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();

  const [name, setName] = useState(b?.name || "");
  const [branch, setBranch] = useState(b?.branch || "");
  const [ifsc, setIfsc] = useState(b?.ifsc || "");
  const [accountNo, setAccountNo] = useState(b?.accountNo || "");
  const [phone, setPhone] = useState(b?.phone || "");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  function onIfscChange(v: string) {
    const upper = v.toUpperCase();
    if (IFSC_RE.test(upper)) setIfsc(upper);
  }

  function onPhoneChange(v: string) {
    setPhone(v.replace(/\D/g, "").slice(0, 10));
  }

  async function save() {
    const n = name.trim();
    const p = phone.trim();
    if (n.length < 2) { setErr("Please enter a bank name (at least 2 characters)."); return; }
    if (p && !PHONE_RE.test(p)) { setErr("Phone number must be exactly 10 digits."); return; }

    const input = { name: n, branch: branch.trim(), ifsc: ifsc.trim(), accountNo: accountNo.trim(), phone: p };
    setSaving(true);
    setErr("");
    try {
      if (b) await updateBank(b.id, input);
      else await createBankFull(input);
      closeModal();
      onSaved();
      toast(b ? `Bank "${n}" updated` : `Bank "${n}" added`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to save bank.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>{b ? "Edit Bank — " + b.name : "Add Bank"}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="frow c2">
          <div><label className="f">Bank Name *</label>
            <input className="inp" placeholder="e.g. HDFC Bank" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" /></div>
          <div><label className="f">Branch</label>
            <input className="inp" placeholder="e.g. Koratty" value={branch} onChange={(e) => setBranch(e.target.value)} maxLength={120} autoComplete="off" /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">IFSC</label>
            <input className="inp" placeholder="e.g. HDFC0001234" value={ifsc} onChange={(e) => onIfscChange(e.target.value)} maxLength={20} autoComplete="off" /></div>
          <div><label className="f">Account No.</label>
            <input className="inp" placeholder="Account number" value={accountNo} onChange={(e) => setAccountNo(e.target.value)} maxLength={40} autoComplete="off" /></div>
        </div>
        <div className="frow"><div><label className="f">Phone</label>
          <input className="inp" type="tel" inputMode="numeric" placeholder="10-digit phone" value={phone} onChange={(e) => onPhoneChange(e.target.value)} maxLength={10} autoComplete="off" /></div></div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : b ? "Save Changes" : "Add Bank"}</button>
      </div>
    </>
  );
}
