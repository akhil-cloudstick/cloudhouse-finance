"use client";

import { useState } from "react";
import { useData } from "@/lib/DataProvider";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";

const ROLES = [
  "Administrator", "Management", "Branch Manager", "Loan Operator", "Cashier",
  "Accountant", "Collection Staff", "Auction Admin", "Auditor",
];

/* Ported from legacy/app.js's `openEmployeeModal()` / `saveEmployee()`. */
export function EmployeeModalContent() {
  const { db, refresh } = useData();
  const { closeModal } = useModal();
  const toast = useToast();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("");
  const [branch, setBranch] = useState("Koratty");
  const [err, setErr] = useState("");

  function save() {
    const trimmed = name.trim();
    if (trimmed.length < 3) { setErr("Please enter the employee’s full name."); return; }
    if (!role) { setErr("Please select a role."); return; }
    const id = db.addEmployee({ name: trimmed, role, branch, phone: phone.trim(), loans: 0, collections: 0, followups: 0, pending: 0 });
    if (!id) { setErr("Could not save — storage is full."); return; }
    refresh();
    closeModal();
    toast(`${trimmed} added as ${role} (${id})`);
  }

  return (
    <>
      <div className="hd"><h3>Add Employee</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow c2">
          <div><label className="f">Full Name *</label><input className="inp" placeholder="e.g. Arun Kumar" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="f">Mobile Number</label><input className="inp" placeholder="10-digit mobile" maxLength={11} value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">Role *</label>
            <select className="inp" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">Select role…</option>
              {ROLES.map((r) => <option key={r}>{r}</option>)}
            </select></div>
          <div><label className="f">Branch *</label>
            <select className="inp" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option>Koratty</option><option>Angamaly</option><option>Kodakara</option>
            </select></div>
        </div>
        <div className="notice"><Icon name="shield" /> The employee gets role-based access — sensitive actions stay behind approval workflows with a full audit trail.</div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save}><Icon name="check" /> Add Employee</button>
      </div>
    </>
  );
}
