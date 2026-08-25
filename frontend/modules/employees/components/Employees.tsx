"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { Icon } from "@/common/components/Icon";
import { useAuth } from "@/common/auth-context";
import { fmt, initials } from "@/common/utils/format";
import { EmployeeModalContent } from "@/common/components/modals/EmployeeModal";
import { deleteEmployee, listEmployeesPage, type EmployeeView } from "@/modules/employees/services/employeeService";

/* Ported from legacy/app.js's `renderEmployees()`. Loads real data from the
 * Go backend (`GET /api/v1/employees`), following the Branches.tsx pattern. */
export function Employees() {
  const { openModal } = useModal();
  const toast = useToast();
  const { can } = useAuth();
  const canViewRoles = can("Role_Management", "can_view_role_and_permission");
  const canCreateEmployees = can("Employee_Management", "can_create_employee");
  const canUpdateEmployees = can("Employee_Management", "can_update_employee");
  const canDeleteEmployees = can("Employee_Management", "can_delete_employee");
  const [employees, setEmployees] = useState<EmployeeView[] | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  async function load() {
    try {
      const res = await listEmployeesPage(page);
      setEmployees(res.items);
      setHasMore(res.hasMore);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load employees.");
    }
  }

  useEffect(() => { load(); }, [page]);

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

  const totalPages = hasMore ? page + 1 : page;

  return (
    <>
      <div className="page-h">
        <div><h1>Employees &amp; Roles</h1><p>Role-based access · performance across loans, collections and follow-ups</p></div>
        <div className="sp" />
        {canViewRoles && (
          <a className="btn ghost" href="#roles-permissions"><Icon name="shield" /> Roles</a>
        )}
        {canCreateEmployees && (
          <button className="btn" onClick={() => openModal(<EmployeeModalContent onSaved={onSaved} />)}><Icon name="plus" /> Add Employee</button>
        )}
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
            <table className="tbl tbl-center col1-left">
              <thead>
                <tr><th>Employee</th><th>Role</th><th>Branch</th><th className="num">Loans Processed</th><th className="num">Collections</th><th className="num">Follow-ups</th><th className="num">Pending</th><th>Action</th></tr>
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
                      {(canUpdateEmployees || canDeleteEmployees) && (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
                          {canUpdateEmployees && (
                            <a href="#" onClick={(ev) => { ev.preventDefault(); openModal(<EmployeeModalContent employee={e} onSaved={onSaved} />); }}>Edit</a>
                          )}
                          {canDeleteEmployees && (
                            <a href="#" style={{ color: "var(--red)" }} onClick={(ev) => { ev.preventDefault(); onDelete(e); }}>Delete</a>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ft" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="btn plain sm" style={{ padding: "4px 10px" }} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
            <span style={{ fontSize: 12.5 }}>Page {page} of {totalPages}</span>
            <button className="btn plain sm" style={{ padding: "4px 10px" }} disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next ›</button>
          </div>
        </div>
      )}
    </>
  );
}
