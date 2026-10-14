"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { Select } from "@/common/components/ui/Select";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";
import { ApiError } from "@/common/services/httpClient";
import { listActiveBranches } from "@/modules/branches/services/branchService";
import { type BranchView } from "@/modules/branches/types/branch-types";
import { useBranding } from "@/common/providers/BrandingProvider";
import { useLockedBranchId, useShowBranch } from "@/common/hooks/use-branch-switch";
import { createLocker, updateLocker } from "@/modules/lockers/services/lockerService";
import { type LockerView } from "@/modules/lockers/types/locker-types";
import { singleFlight } from "@/common/utils/singleFlight";

const CODE_RE = /^[A-Za-z0-9-]*$/;

// Server messages are put on the field they are about, by wording.
const SERVER_FIELDS: Record<string, RegExp> = {
  code: /code/i,
  capacity: /capacity/i,
  branch: /branch/i,
};

type LockerModalContentProps = { locker?: LockerView; onSaved?: () => void };

/* Ported from legacy/app.js's `openLockerModal()` / `saveNewLocker()`, now
 * wired to the real Go backend (`POST`/`PUT /api/v1/lockers`) — mirrors
 * EmployeeModal.modules/banks/components/BankModalContent.tsx's rewire pattern. Branch options come
 * from the real Branch Management API. Supports both create and edit
 * modes — pass `locker` to pre-fill and edit an existing record. */
export function LockerModalContent({ locker, onSaved }: LockerModalContentProps) {
  const { closeModal } = useModal();
  const toast = useToast();

  // Locked (and defaulted) to the global branch selection when one is
  // active, the same way a single-branch business locks it.
  const lockedBranchId = useLockedBranchId();
  const [code, setCode] = useState(locker?.code || "");
  const [cap, setCap] = useState(String(locker?.capacity || 30));
  const [branchId, setBranchId] = useState<number | "">(locker?.branchId || lockedBranchId || "");
  const [isActive, setIsActive] = useState(locker?.isActive ?? true);
  const [branches, setBranches] = useState<BranchView[]>([]);
  // Single-branch business: the one branch is preselected and the picker locked.
  const { singleBranch } = useBranding();
  // Single-branch plan: no branch is ever shown — the field is not rendered.
  const showBranch = useShowBranch();
  const branchLocked = singleBranch || lockedBranchId != null;
  const [err, setErr] = useState("");
  const [fe, setFe] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listActiveBranches().then((list) => {
      setBranches(list);
      if (!locker && !branchId && list.length) setBranchId(list[0].id);
    }).catch(() => setErr("Could not load branches — try again later."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fail = (field: string, msg: string) => { setErr(""); setFe({ [field]: msg }); };
  const clearFe = (field: string) => setFe((cur) => (cur[field] ? { ...cur, [field]: "" } : cur));

  async function save() { return singleFlight("modal:locker:save", async () => {
    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedCode) { fail("code", "Locker code is required."); return; }
    if (!CODE_RE.test(trimmedCode)) { fail("code", "Locker code may only contain letters, numbers and hyphens."); return; }
    if (branchId === "") { fail("branch", "Please select a branch."); return; }
    const capacity = parseInt(cap, 10);
    if (!capacity || capacity <= 0) { fail("capacity", "Capacity must be greater than zero."); return; }

    setSaving(true);
    setErr("");
    setFe({});
    try {
      const input = { code: trimmedCode, branchId: Number(branchId), capacity, isActive };
      if (locker) {
        await updateLocker(locker.id, input);
        toast(`Locker ${trimmedCode} updated`);
      } else {
        await createLocker(input);
        toast(`Locker ${trimmedCode} added`);
      }
      onSaved?.();
      closeModal();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not save the locker — try again.";
      const field = e instanceof ApiError ? fieldForMessage(msg, SERVER_FIELDS) : "";
      if (field) fail(field, msg); else setErr(msg);
    } finally {
      setSaving(false);
    }
  }); }

  return (
    <>
      <div className="hd"><h3>{locker ? `Edit Locker — ${locker.code}` : "Add Locker"}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="frow c2">
          <div className={fe.code ? "has-err" : undefined}><label className="f">Locker Code *</label><input className="inp" placeholder="e.g. LKR-B2" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); clearFe("code"); }} /><FieldError msg={fe.code} /></div>
          <div className={fe.capacity ? "has-err" : undefined}><label className="f">Capacity (packets) *</label><input className="inp" type="number" min={1} value={cap} onChange={(e) => { setCap(e.target.value); clearFe("capacity"); }} /><FieldError msg={fe.capacity} /></div>
        </div>
        {showBranch && (
          <div className="frow"><div className={fe.branch ? "has-err" : undefined}><label className="f">Branch *</label>
            <Select
              disabled={branchLocked}
              options={[{ value: "", label: "Select branch…" }, ...branches.map((b) => ({ value: String(b.id), label: b.name }))]}
              value={branchId === "" ? "" : String(branchId)}
              onChange={(v) => { setBranchId(v ? Number(v) : ""); clearFe("branch"); }}
            />
            <FieldError msg={fe.branch} />
          </div></div>
        )}
        {locker && (
          <div className="frow"><div><label className="f">Status</label>
            <Select
              options={[{ value: "true", label: "Active" }, { value: "false", label: "Inactive" }]}
              value={String(isActive)}
              onChange={(v) => setIsActive(v === "true")}
            />
          </div></div>
        )}
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {locker ? "Save Changes" : "Add Locker"}</button>
      </div>
    </>
  );
}
