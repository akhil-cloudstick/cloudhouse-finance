"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { Icon } from "@/product/components/Icon";
import { Select } from "@/product/components/ui/Select";
import { ApiError } from "@/product/services/httpClient";
import { listActiveBranches, type BranchView } from "@/product/pages/branches/services/branchService";
import { useBranding } from "@/product/providers/BrandingProvider";
import { createLocker, updateLocker, type LockerView } from "@/product/pages/lockers/services/lockerService";
import { singleFlight } from "@/product/utils/singleFlight";

const CODE_RE = /^[A-Za-z0-9-]*$/;

/* Ported from legacy/app.js's `openLockerModal()` / `saveNewLocker()`, now
 * wired to the real Go backend (`POST`/`PUT /api/v1/lockers`) — mirrors
 * EmployeeModal.tsx/BankModal.tsx's rewire pattern. Branch options come
 * from the real Branch Management API. Supports both create and edit
 * modes — pass `locker` to pre-fill and edit an existing record. */
export function LockerModalContent({ locker, onSaved }: { locker?: LockerView; onSaved?: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();

  const [code, setCode] = useState(locker?.code || "");
  const [cap, setCap] = useState(String(locker?.capacity || 30));
  const [branchId, setBranchId] = useState<number | "">(locker?.branchId || "");
  const [isActive, setIsActive] = useState(locker?.isActive ?? true);
  const [branches, setBranches] = useState<BranchView[]>([]);
  // Single-branch business: the one branch is preselected and the picker locked.
  const { singleBranch } = useBranding();
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listActiveBranches().then((list) => {
      setBranches(list);
      if (!locker && !branchId && list.length) setBranchId(list[0].id);
    }).catch(() => setErr("Could not load branches — try again later."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() { return singleFlight("modal:locker:save", async () => {
    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedCode) { setErr("Locker code is required."); return; }
    if (!CODE_RE.test(trimmedCode)) { setErr("Locker code may only contain letters, numbers and hyphens."); return; }
    if (branchId === "") { setErr("Please select a branch."); return; }
    const capacity = parseInt(cap, 10);
    if (!capacity || capacity <= 0) { setErr("Capacity must be greater than zero."); return; }

    setSaving(true);
    setErr("");
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
      setErr(e instanceof ApiError ? e.message : "Could not save the locker — try again.");
    } finally {
      setSaving(false);
    }
  }); }

  return (
    <>
      <div className="hd"><h3>{locker ? `Edit Locker — ${locker.code}` : "Add Locker"}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="frow c2">
          <div><label className="f">Locker Code *</label><input className="inp" placeholder="e.g. LKR-B2" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></div>
          <div><label className="f">Capacity (packets) *</label><input className="inp" type="number" min={1} value={cap} onChange={(e) => setCap(e.target.value)} /></div>
        </div>
        <div className="frow"><div><label className="f">Branch *</label>
          <Select
            disabled={singleBranch}
            options={[{ value: "", label: "Select branch…" }, ...branches.map((b) => ({ value: String(b.id), label: b.name }))]}
            value={branchId === "" ? "" : String(branchId)}
            onChange={(v) => setBranchId(v ? Number(v) : "")}
          />
        </div></div>
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
