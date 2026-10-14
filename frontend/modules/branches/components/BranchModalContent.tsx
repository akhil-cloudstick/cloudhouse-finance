"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { Select } from "@/common/components/ui/Select";
import { createBranch, updateBranch } from "@/modules/branches/services/branchService";
import { type BranchView } from "@/modules/branches/types/branch-types";
import { singleFlight } from "@/common/utils/singleFlight";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";

const NAME_RE = /^[A-Za-z][A-Za-z\s.'-]*$/;
const CODE_RE = /^[A-Z0-9-]*$/;
const ADDRESS_RE = /^[A-Za-z0-9\s,./#'-]*$/;
const PHONE_RE = /^\d{10}$/;

// Which field a server message is about, by its words (first match wins).
const SERVER_FIELDS: Record<string, RegExp> = {
  name: /name/i, code: /code/i, address: /address/i, phone: /phone/i,
};

type BranchModalContentProps = { branch?: BranchView; onSaved: () => void };

/* Add/Edit Branch form, following the SchemeModal.tsx pattern — calls the
 * Go backend (`POST`/`PUT /api/v1/branches`) directly. Each field is
 * type-checked both as-you-type (bad characters are filtered out, so the
 * input never holds an invalid value) and again on save. */
export function BranchModalContent({ branch: b, onSaved }: BranchModalContentProps) {
  const { closeModal } = useModal();
  const toast = useToast();

  const [name, setName] = useState(b?.name || "");
  const [code, setCode] = useState(b?.code || "");
  const [address, setAddress] = useState(b?.address || "");
  const [phone, setPhone] = useState(b?.phone || "");
  const [isActive, setIsActive] = useState(b ? b.isActive : true);
  const [err, setErr] = useState("");
  // Validation messages, each shown under the field it is about; `err` keeps the ones that fit no field.
  const [fe, setFe] = useState<Record<string, string>>({});
  const fail = (field: string, msg: string) => { setErr(""); setFe({ [field]: msg }); };
  const [saving, setSaving] = useState(false);

  function onNameChange(v: string) {
    // Letters, spaces, and .'- only — no digits or other symbols in a branch name.
    if (v === "" || /^[A-Za-z\s.'-]*$/.test(v)) setName(v);
  }

  function onCodeChange(v: string) {
    // Uppercase alphanumeric + hyphen, e.g. "KOR01" — auto-uppercased as you type.
    const upper = v.toUpperCase();
    if (CODE_RE.test(upper)) setCode(upper);
  }

  function onAddressChange(v: string) {
    if (v === "" || ADDRESS_RE.test(v)) setAddress(v);
  }

  function onPhoneChange(v: string) {
    // Digits only, capped at 10.
    const digits = v.replace(/\D/g, "").slice(0, 10);
    setPhone(digits);
  }

  async function save() { return singleFlight("modal:branch:save", async () => {
    const n = name.trim();
    const a = address.trim();
    const p = phone.trim();

    if (n.length < 2 || !NAME_RE.test(n)) {
      fail("name", "Please enter a valid branch name (letters only, at least 2 characters).");
      return;
    }
    if (!code.trim()) { fail("code", "Please enter a branch code."); return; }
    if (a.length < 3) { fail("address", "Please enter a branch address (at least 3 characters)."); return; }
    if (p && !PHONE_RE.test(p)) { fail("phone", "Phone number must be exactly 10 digits."); return; }

    const input = { name: n, code: code.trim(), address: a, phone: p, isActive };
    setSaving(true);
    setErr("");
    setFe({});
    try {
      if (b) await updateBranch(b.id, input);
      else await createBranch(input);
      onSaved();
      closeModal();
      toast(b ? `Branch "${n}" updated` : `Branch "${n}" created`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save branch.";
      const field = fieldForMessage(msg, SERVER_FIELDS);
      if (field) fail(field, msg); else setErr(msg);
    } finally {
      setSaving(false);
    }
  }); }

  return (
    <>
      <div className="hd"><h3>{b ? "Edit Branch — " + b.name : "Add Branch"}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="frow c2">
          <div className={fe.name ? "has-err" : undefined}><label className="f">Branch Name *</label>
            <input
              className="inp"
              placeholder="e.g. Koratty"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              maxLength={80}
              autoComplete="off"
            /><FieldError msg={fe.name} /></div>
          <div className={fe.code ? "has-err" : undefined}><label className="f">Branch Code *</label>
            <input
              className="inp"
              placeholder="e.g. KOR01"
              value={code}
              onChange={(e) => onCodeChange(e.target.value)}
              maxLength={20}
              autoComplete="off"
            /><FieldError msg={fe.code} /></div>
        </div>
        <div className="frow"><div className={fe.address ? "has-err" : undefined}><label className="f">Address *</label>
          <input
            className="inp"
            placeholder="Full branch address"
            value={address}
            onChange={(e) => onAddressChange(e.target.value)}
            maxLength={255}
            autoComplete="off"
          /><FieldError msg={fe.address} /></div></div>
        <div className="frow c2">
          <div className={fe.phone ? "has-err" : undefined}><label className="f">Phone</label>
            <input
              className="inp"
              type="tel"
              inputMode="numeric"
              placeholder="10-digit landline/mobile"
              value={phone}
              onChange={(e) => onPhoneChange(e.target.value)}
              maxLength={10}
              autoComplete="off"
            /><FieldError msg={fe.phone} /></div>
          <div><label className="f">Status</label>
            <Select
              options={[{ value: "1", label: "Active" }, { value: "0", label: "Inactive" }]}
              value={isActive ? "1" : "0"}
              onChange={(v) => setIsActive(v === "1")}
            /></div>
        </div>
        <div className="notice"><Icon name="shield" /> Branches cannot be deactivated while employees, expenses or cash movements still reference them.</div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : b ? "Save Changes" : "Add Branch"}</button>
      </div>
    </>
  );
}
