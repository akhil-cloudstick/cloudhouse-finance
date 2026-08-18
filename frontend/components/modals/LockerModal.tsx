"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { ApiError } from "@/lib/api";
import { listActiveBranches, type BranchView } from "@/lib/branchApi";
import { createLocker, updateLocker, type LockerView } from "@/lib/lockerApi";

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
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listActiveBranches().then((list) => {
      setBranches(list);
      if (!locker && !branchId && list.length) setBranchId(list[0].id);
    }).catch(() => setErr("Could not load branches — try again later."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
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
  }

  return (
    <>
      <div className="hd"><h3>{locker ? `Edit Locker — ${locker.code}` : "Add Locker"}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow c2">
          <div><label className="f">Locker Code *</label><input className="inp" placeholder="e.g. LKR-B2" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></div>
          <div><label className="f">Capacity (packets) *</label><input className="inp" type="number" min={1} value={cap} onChange={(e) => setCap(e.target.value)} /></div>
        </div>
        <div className="frow"><div><label className="f">Branch *</label>
          <select className="inp" value={branchId} onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Select branch…</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div></div>
        {locker && (
          <div className="frow">
            <label className="ccheck" style={{ alignItems: "center", fontSize: 13.5 }}>
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              <span className="mark" />
              Active
            </label>
          </div>
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
