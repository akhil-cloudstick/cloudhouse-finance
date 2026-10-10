"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { useAuth } from "@/common/providers/AuthProvider";
import { fmt, initials } from "@/common/utils/format";
import { EmployeeModalContent } from "@/modules/employees/components/EmployeeModalContent";
import { ConfirmModalContent } from "@/common/components/modals/ConfirmModalContent";
import { deleteEmployee, listEmployeesPage } from "@/modules/employees/services/employeeService";
import { type EmployeeView } from "@/modules/employees/types/employee-types";
import { useResponsivePageSize } from "@/common/utils/responsive";
import { routeHref } from "@/common/services/appRoutes";
import { useShowBranch } from "@/common/hooks/use-branch-switch";

/* Ported from legacy/app.js's `renderEmployees()`. Loads real data from the
 * Go backend (`GET /api/v1/employees`), following the Branches.tsx pattern. */
export function EmployeesPage() {
  const { openModal } = useModal();
  const toast = useToast();
  const { can } = useAuth();
  const showBranch = useShowBranch();
  const pageSize = useResponsivePageSize(15, 15);
  const canViewRoles = can("Role_Management", "can_view_role_and_permission_module");
  const canCreateEmployees = can("Employee_Management", "can_create_employee");
  const canUpdateEmployees = can("Employee_Management", "can_update_employee");
  const canDeleteEmployees = can("Employee_Management", "can_delete_employee");
  const [employees, setEmployees] = useState<EmployeeView[] | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function load() {
    try {
      const res = await listEmployeesPage(page, pageSize);
      setEmployees(res.items);
      setTotal(res.total);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load employees.");
    }
  }

  useEffect(() => { load(); }, [page, pageSize]);

  function onSaved() {
    load();
  }

  function onDelete(e: EmployeeView) {
    openModal(
      <ConfirmModalContent
        title="Delete Employee"
        message={`Delete employee "${e.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        busyLabel="Deleting…"
        onConfirm={async () => {
          await deleteEmployee(e.id);
          toast(`Employee "${e.name}" deleted`);
          load();
        }}
      />
    );
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Employees &amp; Roles</h1><p>Role-based access · performance across loans, collections and follow-ups</p></div>
        <div className="sp" />
        {canViewRoles && (
          <a className="btn ghost" href={routeHref("roles-permissions")}><Icon name="shield" /> Roles</a>
        )}
        {canCreateEmployees && (
          <button className="btn" onClick={() => openModal(<EmployeeModalContent onSaved={onSaved} />)}><Icon name="plus" /> Add Employee</button>
        )}
      </div>
      <hr className="gold-rule rule-lg" />
      {error && (
        <p style={{ color: "var(--red)", fontSize: 13.5 }}>
          Something went wrong. Please try again later.
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
        <div className="card tbl-card tbl-card-fill tbl-rounded">
          <div className="tbl-wrap">
            <table className="tbl tbl-center col1-left tbl-tight emp-tbl">
              <thead>
                <tr><th>Employee</th><th>Role</th>{showBranch && <th>Branch</th>}<th className="num">Loans Processed</th><th className="num">Collections</th><th className="num">Follow-ups</th><th className="num">Pending</th><th>Action</th></tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                        {/* flexShrink:0 — the parent span is display:inline-flex,
                          * and a flex item's default flex-shrink:1 applies even
                          * with an explicit width/height set, so a long employee
                          * name pushing this row's content past its column's
                          * available width was squeezing the circle down instead
                          * of just wrapping/truncating the name text beside it. */}
                        <span className="av" style={{ width: 30, height: 30, flexShrink: 0, borderRadius: "50%", background: "linear-gradient(135deg,var(--brand-mid),var(--brand-deep))", color: "#fff", display: "grid", placeContent: "center", fontWeight: 600, fontSize: 11.5 }}>{initials(e.name)}</span>
                        <span><b>{e.name}</b><span className="sub">{e.code}</span></span>
                      </span>
                    </td>
                    <td><span className={`chip ${e.role === "Administrator" ? "brand" : e.role === "Branch Manager" ? "info" : "gray"}`}>{e.role}</span></td>
                    {showBranch && <td>{e.branchName}</td>}
                    <td className="num">{e.loansProcessed || "—"}</td>
                    <td className="num">{fmt(e.collections)}</td>
                    <td className="num">{e.followups}</td>
                    <td className="num">{e.pending}</td>
                    <td>
                      {(canUpdateEmployees || canDeleteEmployees) && (
                        <div className="emp-actions" style={{ display: "flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap" }}>
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
            <button className="btn plain sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
            <span style={{ fontSize: 12.5 }}>Page {page} of {totalPages}</span>
            <button className="btn plain sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next ›</button>
          </div>
        </div>
      )}
    </>
  );
}
