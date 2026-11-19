"use client";

import { useEffect, useRef, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { Icon } from "@/common/components/Icon";
import { TruncText } from "@/common/components/ui/TruncText";
import { TableCols } from "@/common/components/ui/TableCols";
import { TableSearch } from "@/common/components/ui/TableSearch";
import { useDebouncedValue } from "@/common/hooks/use-debounced-value";
import { ApiError } from "@/common/services/httpClient";
import { fetchRoleEmployees, fetchRolesPage } from "@/common/services/permissionService";
import { type RoleEmployeeRow, type RoleListRow } from "@/common/types/permission-types";

const ROLES_PAGE_SIZE = 12;
const EMPLOYEES_PAGE_SIZE = 10;
// The employees list shows about three rows, then scrolls.
const EMPLOYEES_MAX_H = 136;

type RolesListModalContentProps = {
  /* Opens the role's permissions on the page behind the modal. */
  onOpenRole: (roleId: number) => void;
};

/* Every role — paged in the footer, like the Investors modal — each opening to the employees who hold it. */
export function RolesListModalContent(_props: RolesListModalContentProps) {
  const { closeModal } = useModal();
  const [q, setQ] = useState("");
  const search = useDebouncedValue(q.trim(), 300);
  const [page, setPage] = useState(1);
  const [roles, setRoles] = useState<RoleListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  // Loading until the request for the current search + page has answered.
  const reqKey = `${search}|${page}`;
  const [loadedKey, setLoadedKey] = useState("");
  const loading = loadedKey !== reqKey;

  useEffect(() => {
    let live = true;
    fetchRolesPage(page, ROLES_PAGE_SIZE, search || undefined)
      .then((res) => {
        if (!live) return;
        setRoles(res.items);
        setTotal(res.total);
        setHasMore(res.hasMore);
        setError("");
      })
      .catch((e) => { if (live) setError(e instanceof ApiError ? e.message : "Could not load roles."); })
      .finally(() => { if (live) setLoadedKey(reqKey); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reqKey is derived from search and page
  }, [search, page]);

  const totalPages = Math.max(1, Math.ceil(total / ROLES_PAGE_SIZE));
  function goTo(p: number) { setOpenId(null); setPage(p); }

  return (
    <>
      <div className="hd"><h3>Roles</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll fixed-h">
        <div style={{ marginBottom: 10 }}>
          <TableSearch value={q} onChange={(v) => { setQ(v); setPage(1); setOpenId(null); }} placeholder="Search roles…" searches="role name" />
        </div>
        {error && <div className="notice">{error}</div>}
        <div className="tbl-wrap tbl-wrap-auto"><table className="tbl tbl-center tbl-cards-sm tbl-compact">
          <TableCols widths={[28, 38, 22, 12]} />
          <thead><tr><th>Role</th><th>Description</th><th className="num">Employees</th><th></th></tr></thead>
          <tbody>
            {loading && roles.length === 0 ? (
              <tr><td colSpan={4} className="empty compact">Loading…</td></tr>
            ) : roles.length === 0 ? (
              <tr><td colSpan={4} className="empty compact">{search ? "No roles match your search." : "No roles yet."}</td></tr>
            ) : roles.map((r) => (
              <RoleRows
                key={r.id}
                role={r}
                open={openId === r.id}
                onToggle={() => setOpenId(openId === r.id ? null : r.id)}
              />
            ))}
          </tbody>
        </table></div>
      </div>
      {/* Pagination sits in the modal footer, left-aligned like every other table's. */}
      <div className="ft" style={{ justifyContent: "flex-start", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <button className="btn plain sm" disabled={page <= 1 || loading} onClick={() => goTo(page - 1)}>‹ Prev</button>
          <span style={{ fontSize: 12.5 }}>Page {page} of {totalPages}</span>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>· {total.toLocaleString("en-IN")} {total === 1 ? "role" : "roles"}</span>
          <button className="btn plain sm" disabled={!hasMore || loading} onClick={() => goTo(page + 1)}>Next ›</button>
        </div>
      </div>
    </>
  );
}

type RoleRowsProps = { role: RoleListRow; open: boolean; onToggle: () => void };

/* A role's row, and — while open — the employees who hold it underneath. */
function RoleRows({ role, open, onToggle }: RoleRowsProps) {
  return (
    <>
      <tr className="click" onClick={onToggle} aria-expanded={open}>
        <td data-label="Role">
          <TruncText text={role.name} maxWidth="100%" style={{ fontWeight: 500 }} />
          {role.isSystem
            ? <span className="sub">System role · read-only</span>
            : !role.isActive && <span className="sub">Inactive</span>}
        </td>
        <td data-label="Description"><TruncText text={role.description} maxWidth="100%" /></td>
        <td className="num" data-label="Employees">{role.employee_count}</td>
        <td className="td-chev" style={{ whiteSpace: "nowrap" }}>
          <Icon name="chevronDown" style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s", verticalAlign: "middle" }} />
        </td>
      </tr>
      {open && (
        <tr><td colSpan={4} style={{ background: "var(--brand-faint)" }}>
          <RoleEmployees roleId={role.id} />
        </td></tr>
      )}
    </>
  );
}

/* One role's employees, loaded 10 at a time as the list is scrolled — same as an investor's investments. */
function RoleEmployees({ roleId }: { roleId: number }) {
  const [items, setItems] = useState<RoleEmployeeRow[] | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(true);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    fetchRoleEmployees(roleId, page, EMPLOYEES_PAGE_SIZE)
      .then((res) => {
        if (!live) return;
        setItems((cur) => (page === 1 ? res.items : [...(cur || []), ...res.items]));
        setHasMore(res.hasMore);
      })
      .catch((e) => { if (live) setError(e instanceof ApiError ? e.message : "Could not load employees."); })
      .finally(() => { if (live) setLoadingMore(false); });
    return () => { live = false; };
  }, [roleId, page]);

  function loadNext() {
    setLoadingMore(true);
    setPage((p) => p + 1);
  }
  // The next 10 load as this list is scrolled to its end.
  function onScroll() {
    const el = wrapRef.current;
    if (hasMore && !loadingMore && el && el.scrollHeight - el.scrollTop - el.clientHeight < 32) loadNext();
  }

  if (error) return <div className="notice">{error}</div>;
  return (
    <div ref={wrapRef} onScroll={onScroll} className="inv-scroll" style={{ maxHeight: EMPLOYEES_MAX_H, overflowY: "auto" }}>
      <table className="tbl tbl-center tbl-cards-sm tbl-compact" style={{ margin: "4px 0 8px" }}>
        <TableCols widths={[24, 46, 30]} />
        <thead><tr><th>Code</th><th>Employee</th><th>Branch</th></tr></thead>
        <tbody>
          {items === null ? (
            <tr><td colSpan={3} className="empty compact">Loading…</td></tr>
          ) : items.length === 0 ? (
            <tr><td colSpan={3} className="empty compact">No employees in this role.</td></tr>
          ) : items.map((e) => (
            <tr key={e.id}>
              <td data-label="Code"><span className="id">{e.code || "—"}</span></td>
              <td data-label="Employee"><TruncText text={e.name} maxWidth="100%" /></td>
              <td data-label="Branch"><TruncText text={e.branchName} maxWidth="100%" /></td>
            </tr>
          ))}
          {items && items.length > 0 && loadingMore && (
            <tr><td colSpan={3} className="empty compact">Loading…</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
