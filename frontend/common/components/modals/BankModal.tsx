"use client";

import { useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { Icon } from "@/common/components/Icon";
import { ApiError } from "@/common/services/httpClient";
import { createBankFull } from "@/modules/banks/services/bankService";

const NAME_RE = /^[A-Za-z][A-Za-z\s.'-]*$/;
const CODE_RE = /^[A-Z0-9-]*$/;
const ADDRESS_RE = /^[A-Za-z0-9\s,./#'-]*$/;
const PHONE_RE = /^\d{10}$/;
const ACCOUNT_RE = /^[A-Za-z0-9]*$/;

/* Add Bank form — follows BranchModal.tsx's pattern exactly. Calls the real
 * Go backend (`POST /api/v1/banks`, find-or-create semantics: an existing
 * bank with the same name is returned as-is rather than erroring). */
export function BankModalContent({ onSaved }: { onSaved: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();

  const [name, setName] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [address, setAddress] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  function onNameChange(v: string) {
    if (v === "" || /^[A-Za-z\s.'-]*$/.test(v)) setName(v);
  }

  function onIfscChange(v: string) {
    // Uppercase alphanumeric + hyphen, e.g. "HDFC0001234" — auto-uppercased as you type.
    const upper = v.toUpperCase();
    if (CODE_RE.test(upper)) setIfsc(upper);
  }

  function onAddressChange(v: string) {
    if (v === "" || ADDRESS_RE.test(v)) setAddress(v);
  }

  function onPhoneChange(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, 10);
    setPhone(digits);
  }

  function onAccountNoChange(v: string) {
    const upper = v.toUpperCase();
    if (ACCOUNT_RE.test(upper)) setAccountNo(upper);
  }

  async function save() {
    const n = name.trim();
    const i = ifsc.trim();
    const a = address.trim();
    const acc = accountNo.trim();
    const p = phone.trim();

    if (n.length < 2 || !NAME_RE.test(n)) {
      setErr("Please enter a valid bank name (letters only, at least 2 characters).");
      return;
    }
    if (!i) { setErr("Please enter the IFSC code."); return; }
    if (!a || a.length < 3) { setErr("Please enter the branch address (at least 3 characters)."); return; }
    if (!acc || acc.length < 4) { setErr("Please enter a valid bank account number (at least 4 characters)."); return; }
    if (p && !PHONE_RE.test(p)) { setErr("Phone number must be exactly 10 digits."); return; }

    setSaving(true);
    setErr("");
    try {
      const rec = await createBankFull({ name: n, ifsc: i, branch: a, accountNo: acc, phone: p });
      onSaved();
      closeModal();
      toast(`Bank "${rec.name}" added`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to save bank.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Add Bank</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow c2">
          <div><label className="f">Bank Name *</label>
            <input
              className="inp"
              placeholder="e.g. HDFC Bank"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              maxLength={120}
              autoComplete="off"
            /></div>
          <div><label className="f">IFSC Code *</label>
            <input
              className="inp"
              placeholder="e.g. HDFC0001234"
              value={ifsc}
              onChange={(e) => onIfscChange(e.target.value)}
              maxLength={20}
              autoComplete="off"
            /></div>
        </div>
        <div className="frow"><div><label className="f">Branch Address *</label>
          <input
            className="inp"
            placeholder="Full branch address"
            value={address}
            onChange={(e) => onAddressChange(e.target.value)}
            maxLength={120}
            autoComplete="off"
          /></div></div>
        <div className="frow"><div><label className="f">Account Number *</label>
          <input
            className="inp"
            placeholder="Bank account number"
            value={accountNo}
            onChange={(e) => onAccountNoChange(e.target.value)}
            maxLength={30}
            autoComplete="off"
          /></div></div>
        <div className="frow"><div><label className="f">Phone Number</label>
          <input
            className="inp"
            type="tel"
            inputMode="numeric"
            placeholder="10-digit phone"
            value={phone}
            onChange={(e) => onPhoneChange(e.target.value)}
            maxLength={10}
            autoComplete="off"
          /></div></div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Add Bank"}</button>
      </div>
    </>
  );
}
