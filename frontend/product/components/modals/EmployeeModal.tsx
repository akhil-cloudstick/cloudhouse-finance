"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { Icon } from "@/product/components/Icon";
import { ApiError } from "@/product/services/httpClient";
import { useAuth } from "@/product/providers/auth-context";
import { listActiveBranches, type BranchView } from "@/product/pages/branches/services/branchService";
import { createEmployee, updateEmployee, type EmployeeView } from "@/product/pages/employees/services/employeeService";
import { Select } from "@/product/components/ui/Select";

/* Canonical role whitelist — MUST stay identical to `ValidRoles` in
 * backend/internal/employee/service.go. There is no shared codegen between
 * the two, so any edit here must be mirrored there. */
const ROLES = [
  "Administrator", "Management", "Branch Manager", "Loan Operator", "Cashier",
  "Accountant", "Collection Staff", "Auction Administrator", "Auditor",
];

/* "Administrator" was useful while every install had exactly one login that
 * needed to do everything for testing — with real tenants now created
 * through the superadmin console (each seeded with its own Administrator
 * already granted full access), a business's own admin minting MORE
 * Administrators from this ordinary form is a mistake waiting to happen, not
 * a thing anyone needs. Hidden from the picker rather than removed from
 * ROLES: the role itself still exists server-side (backend/internal/authz's
 * IsSystem protection, and every tenant's seeded admin still needs it), and
 * an employee who already holds it must still show correctly when editing
 * them — see the ROLE_OPTIONS fallback below. */
const HIDDEN_ROLES = new Set(["Administrator"]);

function roleOptionsFor(currentRole: string) {
  const visible = ROLES.filter((r) => !HIDDEN_ROLES.has(r) || r === currentRole);
  return visible.map((r) => ({ value: r, label: r }));
}

const NAME_RE = /^[A-Za-z][A-Za-z\s.'-]*$/;
const PHONE_RE = /^\d{10}$/;
// Mirrors backend/internal/employee/service.go's usernameRe.
const USERNAME_RE = /^[A-Za-z0-9._-]{3,60}$/;

/* Ported from legacy/app.js's `openEmployeeModal()` / `saveEmployee()`, now
 * wired to the real Go backend (`POST`/`PUT /api/v1/employees`) following
 * the BranchModal.tsx pattern. Supports both create and edit modes — pass
 * `employee` to pre-fill and edit an existing record. Branch options come
 * from the real Branch Management API (`GET /api/v1/branches`). */
export function EmployeeModalContent({ employee, onSaved }: { employee?: EmployeeView; onSaved?: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const { isAdmin, branchId: myBranchId } = useAuth();

  const [name, setName] = useState(employee?.name || "");
  const [phone, setPhone] = useState(employee?.phone || "");
  const [role, setRole] = useState(employee?.role || "");
  const [branches, setBranches] = useState<BranchView[]>([]);
  const [branchId, setBranchId] = useState<number | "">(
    employee?.branchId || (!isAdmin && myBranchId ? myBranchId : "")
  );
  // Login credentials — only offered at creation time (see
  // employeeApi.ts's EmployeeFormInput doc comment); both blank means "no
  // login access yet", set up later via Update once that UI exists.
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Non-admins are confined to their own branch (the backend enforces
    // this server-side regardless) — auto-lock the field instead of
    // offering a dropdown of branches they can't actually use.
    if (!isAdmin) {
      if (myBranchId) setBranchId(myBranchId);
      return;
    }
    listActiveBranches().then((list) => {
      setBranches(list);
      if (list.length && !employee) setBranchId((cur) => cur || list[0].id);
    }).catch(() => setErr("Could not load branches — try again later."));
  }, [employee, isAdmin, myBranchId]);

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
    const uname = username.trim();
    if (!employee) {
      if (uname && !USERNAME_RE.test(uname)) {
        setErr("Username must be at least 3 characters (letters, numbers, dots, underscores or hyphens only).");
        return;
      }
      if (password && password.length < 8) { setErr("Password must be at least 8 characters."); return; }
    }

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
        await createEmployee({
          name: trimmed, role, branchId: branchId as number, phone: p,
          username: uname || undefined, password: password || undefined,
        });
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
      <div className="bd bd-scroll">
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
            <Select options={roleOptionsFor(role)} value={role} onChange={setRole} placeholder="Select role…" /></div>
          <div><label className="f">Branch *</label>
            {isAdmin ? (
              <Select
                options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
                value={branchId ? String(branchId) : ""}
                onChange={(v) => setBranchId(v ? Number(v) : "")}
                placeholder="Select branch…"
              />
            ) : (
              // Non-admins are confined to their own branch — the backend
              // enforces this regardless, so the field is locked rather than
              // offering a choice they can't actually use.
              <Select
                options={[{ value: String(branchId || ""), label: employee?.branchName || "Your branch" }]}
                value={String(branchId || "")}
                onChange={() => {}}
                disabled
              />
            )}</div>
        </div>
        {!employee && (
          // Login credentials — set up now, at creation time, so you don't
          // need a separate "reset password" step just to test as this
          // employee. Optional: leave both blank to add the employee
          // without login access yet.
          <div className="frow c2">
            <div><label className="f">Username (for login)</label>
              <input className="inp" placeholder="e.g. arun.kumar" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={60} autoComplete="off" /></div>
            <div><label className="f">Password</label>
              <div style={{ position: "relative" }}>
                <input
                  className="inp"
                  type={passwordVisible ? "text" : "password"}
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  style={{ paddingRight: 36 }}
                />
                <button
                  type="button"
                  className="eye-toggle"
                  aria-label={passwordVisible ? "Hide password" : "Show password"}
                  onClick={() => setPasswordVisible((v) => !v)}
                  style={{
                    position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", padding: 4, cursor: "pointer", display: "flex",
                    color: "var(--muted, #888)",
                  }}
                >
                  <Icon name={passwordVisible ? "eyeOff" : "eye"} />
                </button>
              </div></div>
          </div>
        )}
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
