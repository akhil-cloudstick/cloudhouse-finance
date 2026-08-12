"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { fmt, initials } from "@/lib/format";
import { EmployeeModalContent } from "@/components/modals/EmployeeModal";
import { RolesModalContent } from "@/components/modals/RolesModal";
import { deleteEmployee, listEmployees, type EmployeeView } from "@/lib/employeeApi";

/* Ported from legacy/app.js's `renderEmployees()`. Loads real data from the
 * Go backend (`GET /api/v1/employees`), following the Branches.tsx pattern. */
export function Employees() {
  const { openModal } = useModal();
  const toast = useToast();
  const [employees, setEmployees] = useState<EmployeeView[] | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      setEmployees(await listEmployees());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load employees.");
    }
  }

  useEffect(() => { load(); }, []);

  function onSaved() {
    load();
  }

  async function onDelete(e: EmployeeView) {
    if (!confirm(`Delete employee "${e.name}"? This cannot be undone.`)) return;
    try {
      await deleteEmployee(e.id);
      toast(`Employee "${e.name}" deleted`);
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to delete employee.");
    }
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Employees &amp; Roles</h1><p>Role-based access · performance across loans, collections and follow-ups</p></div>
        <div className="sp" />
        <button className="btn ghost" onClick={() => openModal(<RolesModalContent />)}><Icon name="shield" /> Roles</button>
        <button className="btn" onClick={() => openModal(<EmployeeModalContent onSaved={onSaved} />)}><Icon name="plus" /> Add Employee</button>
      </div>
      <hr className="gold-rule" />
      {error && (
        <p style={{ color: "var(--red)", fontSize: 13.5 }}>
          Could not reach the server — {error}
          <button className="btn plain sm" style={{ marginLeft: 8 }} onClick={load}>Retry</button>
        </p>
      )}
      {!error && employees === null && (
        <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Loading employees…</p>
      )}
      {employees !== null && employees.length === 0 && !error && (
        <p style={{ color: "var(--muted)", fontSize: 13.5 }}>
          No employees yet. Click &quot;Add Employee&quot; to create one.
        </p>
      )}
      {employees !== null && employees.length > 0 && (
        <div className="card">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Employee</th><th>Role</th><th>Branch</th><th className="num">Loans Processed</th><th className="num">Collections</th><th className="num">Follow-ups</th><th className="num">Pending</th><th></th></tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                        <span className="av" style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,var(--gold-light),var(--gold-deep))", color: "#2b2001", display: "grid", placeContent: "center", fontWeight: 600, fontSize: 11.5 }}>{initials(e.name)}</span>
                        <span><b>{e.name}</b><span className="sub">{e.code}</span></span>
                      </span>
                    </td>
                    <td><span className={`chip ${e.role === "Administrator" ? "gold" : e.role === "Branch Manager" ? "blue" : "gray"}`}>{e.role}</span></td>
                    <td>{e.branchName}</td>
                    <td className="num">{e.loansProcessed || "—"}</td>
                    <td className="num">{fmt(e.collections)}</td>
                    <td className="num">{e.followups}</td>
                    <td className="num">{e.pending}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <a href="#" onClick={(ev) => { ev.preventDefault(); openModal(<EmployeeModalContent employee={e} onSaved={onSaved} />); }}>Edit</a>
                        <a href="#" style={{ color: "var(--red)" }} onClick={(ev) => { ev.preventDefault(); onDelete(e); }}>Delete</a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ft">Roles: Administrator · Management · Branch Manager · Loan Operator · Cashier · Accountant · Collection Staff · Auction Administrator · Auditor. Sensitive actions (rate changes, waivers, reversals, closures) sit behind approval workflows with a full audit trail.</div>
        </div>
      )}
    </>
  );
}
