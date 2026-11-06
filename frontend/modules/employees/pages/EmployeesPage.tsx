"use client";

import { TableCols } from "@/common/components/ui/TableCols";
import { ScrollSentinel } from "@/common/components/ui/ScrollSentinel";
import { useEffect, useRef, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { useAuth } from "@/common/providers/AuthProvider";
import { fmt, initials } from "@/common/utils/format";
import { EmployeeModalContent } from "@/modules/employees/components/EmployeeModalContent";
import { ConfirmModalContent } from "@/common/components/modals/ConfirmModalContent";
import { deleteEmployee, listEmployeesPage } from "@/modules/employees/services/employeeService";
import { type EmployeeView } from "@/modules/employees/types/employee-types";
import { useResponsivePageSize, useScrollPageSize } from "@/common/utils/responsive";
import { routeHref } from "@/common/services/appRoutes";
import { TableSearch } from "@/common/components/ui/TableSearch";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/common/components/ui/FilterPanel";
import { fetchRoles } from "@/common/services/permissionService";
import { DEFAULT_ROLES } from "@/modules/employees/components/EmployeeModalContent";
import { listActiveBranches } from "@/modules/branches/services/branchService";
import type { BranchView } from "@/modules/branches/types/branch-types";
import { usePersistedState, usePersistedPage } from "@/common/hooks/use-persisted-state";
import { useShowBranch } from "@/common/hooks/use-branch-switch";

/* Ported from legacy/app.js's `renderEmployees()`. Loads real data from the
 * Go backend (`GET /api/v1/employees`), following the Branches.tsx pattern. */
export function EmployeesPage() {
  const { openModal } = useModal();
  const toast = useToast();
  const { can } = useAuth();
  const showBranch = useShowBranch();
  const basePageSize = useResponsivePageSize(15, 15);
  const { cards, size: pageSize, more } = useScrollPageSize(basePageSize);
  const canViewRoles = can("Role_Management", "can_view_role_and_permission_module");
  const canCreateEmployees = can("Employee_Management", "can_create_employee");
  const canUpdateEmployees = can("Employee_Management", "can_update_employee");
  const canDeleteEmployees = can("Employee_Management", "can_delete_employee");
  const [employees, setEmployees] = useState<EmployeeView[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = usePersistedState("employees:q", "");
  const [roleFilter, setRoleFilter] = usePersistedState("employees:role", "");
  const [branchFilter, setBranchFilter] = usePersistedState("employees:branch", "");
  // The live role list (custom roles too) needs the role-view permission; without it the seeded roles are offered.
  const [roleNames, setRoleNames] = useState<string[]>(DEFAULT_ROLES);
  const [branches, setBranches] = useState<BranchView[]>([]);
  useEffect(() => {
    fetchRoles().then((rs) => { if (rs.length) setRoleNames(rs.map((r) => r.name)); }).catch(() => {});
    listActiveBranches().then(setBranches).catch(() => {});
  }, []);
  const filterCategories: FilterCategory[] = [
    ...(roleNames.length ? [{ key: "role", label: "Role", kind: "static" as const, options: roleNames.map((r) => ({ value: r, label: r })) }] : []),
    ...(showBranch && branches.length ? [{ key: "branch", label: "Branch", kind: "static" as const, options: branches.map((b) => ({ value: String(b.id), label: b.name })) }] : []),
  ];
  // Several picks are kept comma-joined, the form the API takes them in.
  const filterValue: FilterValue = { role: roleFilter ? roleFilter.split(",") : [], branch: branchFilter ? branchFilter.split(",") : [] };
  const [page, setPage] = usePersistedPage("employees");
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function load() {
    try {
      const res = await listEmployeesPage(page, pageSize, q, { role: roleFilter || undefined, branchId: branchFilter || undefined });
      setEmployees(res.items);
      setTotal(res.total);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load employees.");
    }
  }

  useEffect(() => { load(); }, [page, pageSize]);
  // A new search restarts from page 1 (debounced); a search typed on page 1 reloads directly.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    const handle = setTimeout(() => { if (page === 1) void load(); else setPage(1); }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, roleFilter, branchFilter]);

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
          const res = await deleteEmployee(e.id);
          toast(`Employee "${e.name}" deleted${res.queued && res.message ? `. ${res.message}` : ""}`);
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
      {employees !== null && employees.length === 0 && !error && !q.trim() && (
        <p style={{ color: "var(--muted)", fontSize: 13.5 }}>
          No employees yet. Click &quot;Add Employee&quot; to create one.
        </p>
      )}
      {employees !== null && (employees.length > 0 || !!q.trim() || !!roleFilter || !!branchFilter) && (
        <div style={{ margin: "0 0 12px", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          <TableSearch value={q} onChange={setQ} placeholder="Search employees…" searches="name, code, phone, username, email, role, branch" />
          {filterCategories.length > 0 && (
            <FilterPanel
              categories={filterCategories}
              value={filterValue}
              onChange={(next) => {
                setRoleFilter(Array.isArray(next.role) ? next.role.join(",") : "");
                setBranchFilter(Array.isArray(next.branch) ? next.branch.join(",") : "");
              }}
              hideChips
            />
          )}
        </div>
      )}
      {employees !== null && (employees.length > 0 || !!q.trim()) && (
        <div className="card tbl-card tbl-card-fill tbl-rounded">
          <div className="tbl-wrap">
            <table className="tbl tbl-center col1-left tbl-tight emp-tbl tbl-cards">
              <TableCols widths={[20, 12, ...(showBranch ? [11] : []), 11, 11, 11, 11, 10]} />
              <thead>
                <tr><th>Employee</th><th>Role</th>{showBranch && <th>Branch</th>}<th className="num">Loans Processed</th><th className="num">Collections</th><th className="num">Follow-ups</th><th className="num">Pending</th><th>Action</th></tr>
              </thead>
              <tbody>
                {employees.length === 0 && <tr><td colSpan={8} className="empty">No employees match “{q.trim()}”.</td></tr>}
                {employees.map((e) => (
                  <tr key={e.id}>
                    <td data-label="Employee">
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
                    <td data-label="Role"><span className={`chip ${e.role === "Administrator" ? "brand" : e.role === "Branch Manager" ? "info" : "gray"}`}>{e.role}</span></td>
                    {showBranch && <td data-label="Branch">{e.branchName}</td>}
                    <td className="num" data-label="Loans Processed">{e.loansProcessed || "—"}</td>
                    <td className="num" data-label="Collections">{fmt(e.collections)}</td>
                    <td className="num" data-label="Follow-ups">{e.followups}</td>
                    <td className="num" data-label="Pending">{e.pending}</td>
                    <td data-label="Action">
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
          <ScrollSentinel enabled={cards && (page < totalPages)} onVisible={more} watch={employees.length} />
          <div className="ft ft-scroll-hide" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="btn plain sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
            <span style={{ fontSize: 12.5 }}>Page {page} of {totalPages}</span>
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>· {total.toLocaleString("en-IN")} {total === 1 ? "result" : "results"}</span>
            <button className="btn plain sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next ›</button>
          </div>
        </div>
      )}
    </>
  );
}
