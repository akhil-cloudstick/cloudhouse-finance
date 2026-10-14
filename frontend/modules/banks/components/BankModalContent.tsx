"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { Select } from "@/common/components/ui/Select";
import { useBranding } from "@/common/providers/BrandingProvider";
import { useLockedBranchId } from "@/common/hooks/use-branch-switch";
import { listActiveBranches } from "@/modules/branches/services/branchService";
import { type BranchView } from "@/modules/branches/types/branch-types";
import { ApiError } from "@/common/services/httpClient";
import { createBankFull, updateBank } from "@/modules/banks/services/bankService";
import { type BackendBank } from "@/modules/banks/types/bank-types";
import { singleFlight } from "@/common/utils/singleFlight";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";

const IFSC_RE = /^[A-Za-z0-9]*$/;
const PHONE_RE = /^\d{10}$/;

// Which field a server message is about, by its words (first match wins).
const SERVER_FIELDS: Record<string, RegExp> = {
  branchId: /branch/i, name: /name/i, ifsc: /ifsc/i, accountNo: /account/i, phone: /phone/i,
};

type BankModalContentProps = { bank?: BackendBank; onSaved: () => void };

/* Add/Edit Bank form, mirroring BranchModal.tsx's pattern exactly — calls
 * the Go backend (POST/PUT /api/v1/banks) directly.
 *
 * Every bank account belongs to one business branch ("Business branch",
 * required) — distinct from the bank's own branch ("Bank branch", free
 * text). The business branch is locked to the global branch selection when
 * one is active, and hidden in a single-branch business (its one branch is
 * used). */
export function BankModalContent({ bank: b, onSaved }: BankModalContentProps) {
  const { closeModal } = useModal();
  const toast = useToast();

  const [name, setName] = useState(b?.name || "");
  const [branch, setBranch] = useState(b?.branch || "");
  const [ifsc, setIfsc] = useState(b?.ifsc || "");
  const [accountNo, setAccountNo] = useState(b?.accountNo || "");
  const [phone, setPhone] = useState(b?.phone || "");
  const [err, setErr] = useState("");
  // Validation messages, each shown under the field it is about; `err` keeps the ones that fit no field.
  const [fe, setFe] = useState<Record<string, string>>({});
  const fail = (field: string, msg: string) => { setErr(""); setFe({ [field]: msg }); };
  const [saving, setSaving] = useState(false);
  const { singleBranch } = useBranding();
  const lockedBranchId = useLockedBranchId();
  const branchLocked = singleBranch || lockedBranchId != null;
  const [branches, setBranches] = useState<BranchView[]>([]);
  const [branchId, setBranchId] = useState<number | "">(b?.branchId || lockedBranchId || "");

  useEffect(() => {
    listActiveBranches().then((list) => {
      setBranches(list);
      // Single-branch: its one branch. Otherwise leave a new bank's picker
      // empty (required) unless the global selection already filled it.
      if (singleBranch && list.length) setBranchId((cur) => cur || list[0].id);
    }).catch(() => setErr("Could not load branches — try again later."));
  }, [singleBranch]);

  // The edited bank's own branch stays listed even if the (header-scoped)
  // branch list doesn't include it.
  const branchOptions = [
    { value: "", label: "Select branch…" },
    ...branches.map((x) => ({ value: String(x.id), label: x.name })),
    ...(b?.branchId && !branches.some((x) => x.id === b.branchId) ? [{ value: String(b.branchId), label: b.branchName || `Branch #${b.branchId}` }] : []),
  ];

  function onIfscChange(v: string) {
    const upper = v.toUpperCase();
    if (IFSC_RE.test(upper)) setIfsc(upper);
  }

  function onPhoneChange(v: string) {
    setPhone(v.replace(/\D/g, "").slice(0, 10));
  }

  async function save() { return singleFlight("modal:bank:save", async () => {
    const n = name.trim();
    const p = phone.trim();
    if (n.length < 2) { fail("name", "Please enter a bank name (at least 2 characters)."); return; }
    if (p && !PHONE_RE.test(p)) { fail("phone", "Phone number must be exactly 10 digits."); return; }
    if (!branchId) { fail("branchId", "Please select the business branch this account belongs to."); return; }

    const input = { name: n, branchId: Number(branchId), branch: branch.trim(), ifsc: ifsc.trim(), accountNo: accountNo.trim(), phone: p };
    setSaving(true);
    setErr("");
    setFe({});
    try {
      if (b) await updateBank(b.id, input);
      else await createBankFull(input);
      closeModal();
      onSaved();
      toast(b ? `Bank "${n}" updated` : `Bank "${n}" added`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Failed to save bank.";
      const field = fieldForMessage(msg, SERVER_FIELDS);
      if (field) fail(field, msg); else setErr(msg);
    } finally {
      setSaving(false);
    }
  }); }

  return (
    <>
      <div className="hd"><h3>{b ? "Edit Bank — " + b.name : "Add Bank"}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        {/* Business branch first: it decides whose bank account this is. */}
        {!singleBranch && (
          <div className="frow"><div className={fe.branchId ? "has-err" : undefined}><label className="f">Business branch *</label>
            <Select
              disabled={branchLocked}
              options={branchOptions}
              value={branchId === "" ? "" : String(branchId)}
              onChange={(v) => setBranchId(v ? Number(v) : "")}
            /><FieldError msg={fe.branchId} />
          </div></div>
        )}
        <div className="frow c2">
          <div className={fe.name ? "has-err" : undefined}><label className="f">Bank Name *</label>
            <input className="inp" placeholder="e.g. HDFC Bank" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" /><FieldError msg={fe.name} /></div>
          <div><label className="f">Bank branch</label>
            <input className="inp" placeholder="e.g. Koratty" value={branch} onChange={(e) => setBranch(e.target.value)} maxLength={120} autoComplete="off" /></div>
        </div>
        <div className="frow c2">
          <div className={fe.ifsc ? "has-err" : undefined}><label className="f">IFSC</label>
            <input className="inp" placeholder="e.g. HDFC0001234" value={ifsc} onChange={(e) => onIfscChange(e.target.value)} maxLength={20} autoComplete="off" /><FieldError msg={fe.ifsc} /></div>
          <div className={fe.accountNo ? "has-err" : undefined}><label className="f">Account No.</label>
            <input className="inp" placeholder="Account number" value={accountNo} onChange={(e) => setAccountNo(e.target.value)} maxLength={40} autoComplete="off" /><FieldError msg={fe.accountNo} /></div>
        </div>
        <div className="frow"><div className={fe.phone ? "has-err" : undefined}><label className="f">Phone</label>
          <input className="inp" type="tel" inputMode="numeric" placeholder="10-digit phone" value={phone} onChange={(e) => onPhoneChange(e.target.value)} maxLength={10} autoComplete="off" /><FieldError msg={fe.phone} /></div></div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : b ? "Save Changes" : "Add Bank"}</button>
      </div>
    </>
  );
}
