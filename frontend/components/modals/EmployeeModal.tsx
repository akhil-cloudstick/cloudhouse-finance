"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { ApiError } from "@/lib/api";
import { listActiveBranches, type BranchView } from "@/lib/branchApi";
import { createEmployee, updateEmployee, type EmployeeView } from "@/lib/employeeApi";

/* Canonical role whitelist — MUST stay identical to `ValidRoles` in
 * backend/internal/employee/service.go. There is no shared codegen between
 * the two, so any edit here must be mirrored there. */
const ROLES = [
  "Administrator", "Management", "Branch Manager", "Loan Operator", "Cashier",
  "Accountant", "Collection Staff", "Auction Administrator", "Auditor",
];

const NAME_RE = /^[A-Za-z][A-Za-z\s.'-]*$/;
const PHONE_RE = /^\d{10}$/;

/* Ported from legacy/app.js's `openEmployeeModal()` / `saveEmployee()`, now
 * wired to the real Go backend (`POST`/`PUT /api/v1/employees`) following
 * the BranchModal.tsx pattern. Supports both create and edit modes — pass
 * `employee` to pre-fill and edit an existing record. Branch options come
 * from the real Branch Management API (`GET /api/v1/branches`). */
export function EmployeeModalContent({ employee, onSaved }: { employee?: EmployeeView; onSaved?: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();

  const [name, setName] = useState(employee?.name || "");
  const [phone, setPhone] = useState(employee?.phone || "");
  const [role, setRole] = useState(employee?.role || "");
  const [branches, setBranches] = useState<BranchView[]>([]);
  const [branchId, setBranchId] = useState<number | "">(employee?.branchId || "");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listActiveBranches().then((list) => {
      setBranches(list);
      if (list.length && !employee) setBranchId((cur) => cur || list[0].id);
    }).catch(() => setErr("Could not load branches — try again later."));
  }, [employee]);

  function onPhoneChange(v: string) {
    // Digits only, capped at 10 — matches BranchModal.tsx's phone input.
    const digits = v.replace(/\D/g, "").slice(0, 10);
    setPhone(digits);
  }

  async function save() {
    const trimmed = name.trim();
    const p = phone.trim();

    if (trimmed.length < 3 || !NAME_RE.test(trimmed)) {
      setErr("Please enter the employee's full name (letters only, at least 3 characters).");
      return;
    }
    if (!role || !ROLES.includes(role)) { setErr("Please select a role."); return; }
    if (!branchId) { setErr("Please select a branch."); return; }
    if (p && !PHONE_RE.test(p)) { setErr("Phone number must be exactly 10 digits."); return; }

    setSaving(true);
    setErr("");
    try {
      if (employee) {
        await updateEmployee(employee.id, {
          name: trimmed, role, branchId: branchId as number, phone: p,
          loansProcessed: employee.loansProcessed, collections: employee.collections,
          followups: employee.followups, pending: employee.pending,
        });
        toast(`${trimmed} updated`);
      } else {
        await createEmployee({ name: trimmed, role, branchId: branchId as number, phone: p });
        toast(`${trimmed} added as ${role}`);
      }
      onSaved?.();
      closeModal();
    } catch (e) {
      // Server-side errors (5xx) are logged here for debugging but never
      // shown to the user verbatim — only genuine validation messages (4xx,
      // already human-readable) are surfaced directly.
      if (e instanceof ApiError && e.status >= 500) {
        console.error("EmployeeModal save failed:", e);
        setErr("Something went wrong saving this employee. Please try again.");
      } else {
        setErr(e instanceof Error ? e.message : "Failed to save employee.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>{employee ? "Edit Employee — " + employee.name : "Add Employee"}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow c2">
          <div><label className="f">Full Name *</label><input className="inp" placeholder="e.g. Arun Kumar" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" /></div>
          <div><label className="f">Mobile Number</label>
            <input
              className="inp"
              type="tel"
              inputMode="numeric"
              placeholder="10-digit mobile"
              value={phone}
              onChange={(e) => onPhoneChange(e.target.value)}
              maxLength={10}
              autoComplete="off"
            /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">Role *</label>
            <select className="inp" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">Select role…</option>
              {ROLES.map((r) => <option key={r}>{r}</option>)}
            </select></div>
          <div><label className="f">Branch *</label>
            <select className="inp" value={branchId} onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Select branch…</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select></div>
        </div>
        <div className="notice"><Icon name="shield" /> The employee gets role-based access — sensitive actions stay behind approval workflows with a full audit trail.</div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : employee ? "Save Changes" : "Add Employee"}</button>
      </div>
    </>
  );
}
