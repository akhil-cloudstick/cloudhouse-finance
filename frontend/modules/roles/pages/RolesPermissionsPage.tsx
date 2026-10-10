"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/common/components/ToastProvider";
import { useModal } from "@/common/components/ModalProvider";
import { Icon } from "@/common/components/Icon";
import { useAuth } from "@/common/providers/AuthProvider";
import { ApiError } from "@/common/services/httpClient";
import { Select } from "@/common/components/ui/Select";
import { fetchRoleMatrix, fetchRoles, updateRolePermissions, setAllRolePermissions, createRole, updateRole, deleteRole } from "@/common/services/permissionService";
import { type PermissionRef, type PermissionRow, type Role } from "@/common/types/permission-types";

/* "can create loan" -> "create loan", for "cannot enable …" messages. */
function actionLabel(name: string) {
  return name.replace(/^can /, "");
}

type CascadeOffModalContentProps = {
  row: PermissionRow;
  dependents: PermissionRef[];
  onConfirm: () => void;
};

/* Confirm before switching a parent off: everything below it goes too. */
function CascadeOffModalContent({ row, dependents, onConfirm }: CascadeOffModalContentProps) {
  const { closeModal } = useModal();
  return (
    <>
      <div className="hd"><h3>Turn off {actionLabel(row.permissions.name)}?</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <p style={{ fontSize: 13.5, marginTop: 0 }}>
          These permissions need <b>{row.permissions.name}</b>, so they will be turned off too:
        </p>
        <ul style={{ fontSize: 13, margin: 0, paddingLeft: 18 }}>
          {dependents.map((d) => <li key={d.permission_id}>{d.name}</li>)}
        </ul>
      </div>
      <div className="ft" style={{ display: "flex", gap: 8 }}>
        <div className="sp" />
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={() => { onConfirm(); closeModal(); }}>Turn off {dependents.length + 1}</button>
      </div>
    </>
  );
}
import { ApprovalWorkflowSettings } from "@/modules/roles/components/ApprovalWorkflowSettings";

type EditRoleModalContentProps = {
  role: Role;
  canUpdate: boolean;
  canDelete: boolean;
  onSaved: (id: number) => void;
  onDeleted: () => void;
};

/* Rename/delete for one role, opened from the Edit button beside the role
 * picker. Kept in this file since nothing else opens it. */
function EditRoleModalContent({
  role, canUpdate, canDelete, onSaved, onDeleted,
}: EditRoleModalContentProps) {
  const { closeModal } = useModal();
  const toast = useToast();
  const [name, setName] = useState(role.name);
  const [desc, setDesc] = useState(role.description || "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSave() {
    if (!name.trim()) return;
    setBusy(true);
    setErr("");
    try {
      await updateRole(role.id, name.trim(), desc.trim(), role.isActive);
      toast(`Role "${name.trim()}" saved`);
      onSaved(role.id);
      closeModal();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not update role.");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!confirm(`Delete role "${role.name}"? This cannot be undone.`)) return;
    setBusy(true);
    setErr("");
    try {
      await deleteRole(role.id);
      toast(`Role "${role.name}" deleted`);
      onDeleted();
      closeModal();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not delete role.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Edit Role — {role.name}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow">
          <div><label className="f">Name *</label>
            <input className="inp" value={name} onChange={(e) => setName(e.target.value)} disabled={!canUpdate} maxLength={80} />
          </div>
          <div><label className="f">Description</label>
            <input className="inp" value={desc} onChange={(e) => setDesc(e.target.value)} disabled={!canUpdate} placeholder="What this role is for" />
          </div>
        </div>
        {err && <p style={{ color: "var(--red)", fontSize: 13 }}>{err}</p>}
      </div>
      <div className="ft" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {canDelete && (
          <button className="btn ghost" style={{ color: "var(--red)" }} onClick={onDelete} disabled={busy}>Delete role</button>
        )}
        <div className="sp" />
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        {canUpdate && (
          <button className="btn" onClick={onSave} disabled={busy || !name.trim()}><Icon name="check" /> Save</button>
        )}
      </div>
    </>
  );
}

// Hidden the same way, and for the same reason, as EmployeeModal's role
// picker: Administrator stays a real role with its own permissions and
// IsSystem protections, every business still has and needs one — it's just
// not something a tenant should be casually re-permissioning from a
// dropdown. Never hidden if it's already the selected role, so a deep link
// or an already-open view doesn't silently disappear.
function visibleRoles(roles: Role[] | null, currentId: number | null) {
  if (!roles) return roles;
  return roles.filter((r) => !r.isSystem || r.id === currentId);
}

/* The permissions admin screen — one toggle per permission, grouped by
 * module, for whichever role is selected, plus role create/rename/delete.
 * Follows the house role-permission standard's §7.2/§7.3/§4. Reachable from
 * its own nav entry (Administration → Roles & Permissions), not a modal —
 * there's enough going on here (role list, search, a full permission
 * matrix) to want the room a page gives. */
export function RolesPermissionsPage() {
  const { employee, can, refetchPermissions } = useAuth();
  const toast = useToast();
  const { openModal } = useModal();

  const canCreateRole = can("Role_Management", "can_create_role");
  const canUpdateRole = can("Role_Management", "can_update_role");
  const canDeleteRole = can("Role_Management", "can_delete_role");
  // Whether *anything* on this page is editable — drives the shared bits
  // (the "view only" notice, the "system role" caveat) that don't belong to
  // just one of the three granular actions above.
  const canChangeAnything = canCreateRole || canUpdateRole || canDeleteRole;
  // "Permissions" (the role matrix) | "Approval Workflow" (which stages each
  // approval flow uses — see ApprovalWorkflowSettings.tsx).
  const [activeTab, setActiveTab] = useState<"permissions" | "workflow">("permissions");

  const [roles, setRoles] = useState<Role[] | null>(null);
  const [roleId, setRoleId] = useState<number | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [matrix, setMatrix] = useState<Record<string, PermissionRow[]> | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Brief "Changes saved" confirmation beside Save after a successful save.
  const [justSaved, setJustSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);
  const [pending, setPending] = useState<Record<number, boolean>>({});

  // New-role inline form state (rename lives in the Edit modal above).
  const [showNewRole, setShowNewRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDesc, setNewRoleDesc] = useState("");

  function loadRoles(selectId?: number) {
    fetchRoles()
      .then((list) => {
        setRoles(list);
        if (selectId && list.some((r) => r.id === selectId)) {
          setRoleId(selectId);
        } else if (!roleId && list.length > 0) {
          // Default to the first non-hidden role rather than whatever
          // happens to sort first — Administrator is usually alphabetically
          // early and would otherwise land on screen by default.
          const firstVisible = list.find((r) => !r.isSystem) ?? list[0];
          setRoleId(firstVisible.id);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load roles."));
  }

  useEffect(() => {
    loadRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!roleId || !employee) return;
    setPending({});
    fetchRoleMatrix(employee.id, roleId, search || undefined)
      .then((res) => {
        setRole(res.role);
        setMatrix(res.data);
        setError("");
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load permissions."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleId, employee, search]);

  const effective = useMemo(() => {
    if (!matrix) return null;
    const out: Record<string, PermissionRow[]> = {};
    for (const [mod, rows] of Object.entries(matrix)) {
      out[mod] = rows.map((r) => ({ ...r, permission: pending[r.permission_id] ?? r.permission }));
    }
    return out;
  }, [matrix, pending]);

  // A related permission's on/off state including unsaved edits — it may be
  // hidden by the search, so the server's granted flag is the fallback.
  function isOn(ref: PermissionRef) {
    return pending[ref.permission_id] ?? ref.granted;
  }

  // Parents still off — while any is, this permission can't be switched on.
  function missingParents(row: PermissionRow) {
    return (row.parents ?? []).filter((p) => !isOn(p));
  }

  function blockedMessage(row: PermissionRow) {
    const missing = missingParents(row);
    if (missing.length === 0) return "";
    return `Enable ${missing.map((p) => p.label).join(", ")} first`;
  }

  function toggle(row: PermissionRow) {
    if (!canUpdateRole || role?.isSystem) return;
    const current = pending[row.permission_id] ?? row.permission;
    if (!current) {
      if (missingParents(row).length > 0) {
        toast(blockedMessage(row));
        return;
      }
      setPending((p) => ({ ...p, [row.permission_id]: true }));
      return;
    }
    const goingOff = (row.dependents ?? []).filter(isOn);
    const turnOff = () => setPending((p) => {
      const next = { ...p, [row.permission_id]: false };
      for (const d of goingOff) next[d.permission_id] = false;
      return next;
    });
    if (goingOff.length === 0) {
      turnOff();
      return;
    }
    openModal(<CascadeOffModalContent row={row} dependents={goingOff} onConfirm={turnOff} />);
  }

  async function save() {
    if (!employee || !roleId || Object.keys(pending).length === 0) return;
    setSaving(true);
    setError("");
    try {
      const updates = Object.entries(pending).map(([permission_id, permission]) => ({
        permission_id: Number(permission_id),
        permission,
      }));
      await updateRolePermissions(employee.id, roleId, updates);
      // Role names are unique per business; the employee record carries the name, not the id.
      if (role?.name === employee.role) refetchPermissions();
      toast(`Permissions updated for ${role?.name ?? "role"}`);
      setJustSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setJustSaved(false), 2500);
      const res = await fetchRoleMatrix(employee.id, roleId, search || undefined);
      setRole(res.role);
      setMatrix(res.data);
      setPending({});
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save — try again.");
    } finally {
      setSaving(false);
    }
  }

  async function setAll(allowed: boolean) {
    if (!employee || !roleId || role?.isSystem || !canUpdateRole) return;
    setSaving(true);
    try {
      await setAllRolePermissions(employee.id, roleId, allowed);
      if (role?.name === employee.role) refetchPermissions();
      toast(`All permissions ${allowed ? "granted" : "revoked"} for ${role?.name}`);
      const res = await fetchRoleMatrix(employee.id, roleId, search || undefined);
      setRole(res.role);
      setMatrix(res.data);
      setPending({});
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save — try again.");
    } finally {
      setSaving(false);
    }
  }

  async function onCreateRole() {
    if (!newRoleName.trim()) return;
    setSaving(true);
    try {
      const created = await createRole(newRoleName.trim(), newRoleDesc.trim());
      toast(`Role "${created.name}" created`);
      setShowNewRole(false);
      setNewRoleName("");
      setNewRoleDesc("");
      loadRoles(created.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create role.");
    } finally {
      setSaving(false);
    }
  }

  // Rename and delete both moved behind the Edit button's modal — the page
  // itself only needs to refresh the role list once the modal is done.
  function openEditRole() {
    if (!role) return;
    openModal(
      <EditRoleModalContent
        role={role}
        canUpdate={canUpdateRole}
        canDelete={canDeleteRole}
        onSaved={(id) => loadRoles(id)}
        onDeleted={() => { setRoleId(null); loadRoles(); }}
      />
    );
  }

  if (!can("Role_Management", "can_view_role_and_permission_module")) {
    return (
      <div className="notice" style={{ maxWidth: 480, margin: "48px auto" }}>
        You do not have access to this page. Ask your administrator to grant the permission for it.
      </div>
    );
  }

  return (
    <>
      <div className="page-h">
        <div>
          <h1>Roles &amp; Permissions</h1>
          <p>Grant or revoke what each role may view and change, across every module, and choose the approval workflow.</p>
        </div>
        <div className="sp" />
        {canCreateRole && activeTab === "permissions" && (
          <button className="btn ghost" onClick={() => setShowNewRole((v) => !v)}>
            <Icon name="plus" /> New Role
          </button>
        )}
      </div>
      <hr className="gold-rule" />

      <div className="tabs roles-tabs" style={{ marginBottom: 16 }}>
        <button className={activeTab === "permissions" ? "on" : ""} onClick={() => setActiveTab("permissions")}>
          Permissions
        </button>
        <button className={activeTab === "workflow" ? "on" : ""} onClick={() => setActiveTab("workflow")}>
          Approval Workflow
        </button>
      </div>

      {activeTab === "workflow" && <ApprovalWorkflowSettings />}

      {activeTab === "permissions" && showNewRole && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div className="frow" style={{ gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label className="f">Role name</label>
              <input className="inp" value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} placeholder="e.g. Regional Auditor" />
            </div>
            <div style={{ flex: 2 }}>
              <label className="f">Description</label>
              <input className="inp" value={newRoleDesc} onChange={(e) => setNewRoleDesc(e.target.value)} placeholder="What this role is for" />
            </div>
          </div>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0" }}>
            A new role starts with every permission granted — revoke what it shouldn&apos;t have below, after creating it.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={onCreateRole} disabled={saving || !newRoleName.trim()}>Create</button>
            <button className="btn ghost" onClick={() => setShowNewRole(false)}>Cancel</button>
          </div>
        </div>
      )}

      {activeTab === "permissions" && (
      <div className="card" style={{ padding: 16 }}>
        {/* Two control rows: the role picker sits on one line with Edit
            (rename/delete now live in that modal rather than as their own
            rows), and the permission search shares the next line with the
            bulk grant/revoke and Save actions it applies to. */}
        <div className="role-ctl">
          <div style={{ flex: 1, minWidth: 0 }}>
            <label className="f">Role</label>
            <Select
              options={(visibleRoles(roles, roleId) ?? []).map((r) => ({ value: String(r.id), label: `${r.name}${r.isSystem ? " (system)" : ""}` }))}
              value={roleId != null ? String(roleId) : ""}
              onChange={(v) => setRoleId(Number(v))}
              disabled={!roles}
            />
          </div>
          {(canUpdateRole || canDeleteRole) && role && !role.isSystem && (
            <button className="btn ghost" onClick={openEditRole}><Icon name="edit" /> Edit</button>
          )}
        </div>
        <div className="role-ctl">
          <div style={{ flex: 1, minWidth: 0 }}>
            <label className="f">Search permissions</label>
            <input className="inp" placeholder="e.g. loan" title="Searches: permission name" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {canUpdateRole && role && !role.isSystem && (
            <>
              <button className="btn ghost" onClick={() => setAll(true)} disabled={saving}>Grant all</button>
              <button className="btn ghost" onClick={() => setAll(false)} disabled={saving}>Revoke all</button>
              {justSaved && (
                <span className="save-msg" role="status"><Icon name="check" /> Changes saved</span>
              )}
              <button
                className={`btn save-btn${justSaved ? " saved" : ""}`}
                onClick={save}
                disabled={saving || (Object.keys(pending).length === 0 && !justSaved)}
              >
                <Icon name="check" /> {saving ? "Saving…" : justSaved && Object.keys(pending).length === 0 ? "Saved" : `Save${Object.keys(pending).length ? ` (${Object.keys(pending).length})` : ""}`}
              </button>
            </>
          )}
        </div>

        {role?.isSystem && (
          <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 8 }}>
            {role.name} is a system role — its permissions cannot be changed, and it cannot be renamed or deleted.
          </p>
        )}
        {!canChangeAnything && (
          <div className="notice" style={{ marginTop: 12 }}>
            <Icon name="shield" /> You can view roles and permissions but not change them — ask an administrator.
          </div>
        )}

        {error && <p style={{ color: "var(--red)", fontSize: 13, marginTop: 8 }}>{error}</p>}

        {!effective && !error && <p style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 12 }}>Loading…</p>}

        {effective && (
          <div style={{ marginTop: 16 }}>
            {Object.entries(effective).length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: 13 }}>No permissions match &quot;{search}&quot;.</p>
            )}
            {/* Fixed 300px columns via auto-fill (not the previous
             * repeat(4,minmax(0,1fr))) — matches Schemes.tsx's own card
             * grid so both pages' cards stay exactly the same size at any
             * screen width: 4 fixed 1fr columns never reflowed, so cards
             * kept shrinking narrower on anything less than a very wide
             * desktop instead of dropping extra modules onto the next row. */}
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 24 }}>
              {Object.entries(effective).map(([mod, rows]) => (
                <div key={mod} className="card gtop">
                  <div className="hd"><h3 style={{ fontSize: 15 }}>{mod}</h3></div>
                  <div className="bd" style={{ padding: 0 }}>
                    <div className="perm-list-rows">
                      {rows.map((row) => {
                        const blocked = !row.permission ? blockedMessage(row) : "";
                        const softMissing = (row.soft_parents ?? []).filter((p) => !isOn(p));
                        // Indented under a parent that lives in this same card.
                        const nested = (row.parents ?? []).some((p) => rows.some((r) => r.permissions.name === p.name));
                        return (
                          <label
                            key={row.permission_id}
                            className={`ccheck perm-list-row${blocked ? " blocked" : ""}`}
                            title={blocked || undefined}
                            style={{ paddingLeft: nested ? 28 : undefined }}
                          >
                            <input
                              type="checkbox"
                              checked={row.permission}
                              onChange={() => toggle(row)}
                              disabled={!canUpdateRole || role?.isSystem || !!blocked}
                            />
                            <span className="mark" />
                            <span>
                              <b style={{ fontSize: 13 }}>{row.permissions.name}</b>
                              {row.permissions.description && (
                                <span className="sub" style={{ display: "block", fontSize: 11.5 }}>{row.permissions.description}</span>
                              )}
                              {!blocked && row.permission && softMissing.length > 0 && (
                                <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)" }}>
                                  Works best with {softMissing.map((p) => p.label).join(", ")}
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      )}
    </>
  );
}
