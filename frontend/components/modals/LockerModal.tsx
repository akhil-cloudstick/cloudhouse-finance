"use client";

import { useState } from "react";
import { useData } from "@/lib/DataProvider";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";

/* Ported from legacy/app.js's `openLockerModal()` / `saveNewLocker()`. */
export function LockerModalContent() {
  const { db, refresh } = useData();
  const { closeModal } = useModal();
  const toast = useToast();

  const branches = [...new Set(db.lockers.map((l) => l.branch).concat(db.customers.map((c) => c.branch)))].filter(Boolean);

  const [id, setId] = useState("");
  const [cap, setCap] = useState("30");
  const [branch, setBranch] = useState("");
  const [err, setErr] = useState("");

  function save() {
    const result = db.addLocker({ id: id.trim().toUpperCase(), branch: branch.trim(), cap: parseInt(cap, 10) });
    if (!result.ok) { setErr(result.error); return; }
    refresh();
    closeModal();
    toast(`Locker ${id.trim().toUpperCase()} added`);
  }

  return (
    <>
      <div className="hd"><h3>Add Locker</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow c2">
          <div><label className="f">Locker ID *</label><input className="inp" placeholder="e.g. LKR-B2" value={id} onChange={(e) => setId(e.target.value)} /></div>
          <div><label className="f">Capacity (packets) *</label><input className="inp" type="number" min={1} value={cap} onChange={(e) => setCap(e.target.value)} /></div>
        </div>
        <div className="frow"><div><label className="f">Branch *</label>
          <input className="inp" list="lkBranches" placeholder="e.g. Koratty" value={branch} onChange={(e) => setBranch(e.target.value)} />
          <datalist id="lkBranches">{branches.map((b) => <option key={b} value={b} />)}</datalist>
        </div></div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save}><Icon name="check" /> Add Locker</button>
      </div>
    </>
  );
}
