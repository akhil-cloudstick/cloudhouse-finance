"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/common/components/Toast";
import { useModal } from "@/common/components/Modal";
import { Icon } from "@/common/components/Icon";
import { useAuth } from "@/common/auth-context";
import { ApiError } from "@/common/services/httpClient";
import { Select } from "@/common/components/ui/Select";
import {
  fetchRoleMatrix,
  fetchRoles,
  updateRolePermissions,
  setAllRolePermissions,
  createRole,
  updateRole,
  deleteRole,
  type PermissionRow,
  type Role,
} from "@/common/services/permissionService";

/* Rename/delete for one role, opened from the Edit button beside the role
 * picker. Kept in this file since nothing else opens it. */
function EditRoleModalContent({
  role, canUpdate, canDelete, onSaved, onDeleted,
}: {
  role: Role;
  canUpdate: boolean;
  canDelete: boolean;
  onSaved: (id: number) => void;
  onDeleted: () => void;
}) {
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

/* The permissions admin screen — one toggle per permission, grouped by
 * module, for whichever role is selected, plus role create/rename/delete.
 * Follows the house role-permission standard's §7.2/§7.3/§4. Reachable from
 * its own nav entry (Administration → Roles & Permissions), not a modal —
 * there's enough going on here (role list, search, a full permission
 * matrix) to want the room a page gives. */
export function RolesPermissions() {
  const { employee, can } = useAuth();
  const toast = useToast();
  const { openModal } = useModal();

  const canCreateRole = can("Role_Management", "can_create_role");
  const canUpdateRole = can("Role_Management", "can_update_role");
  const canDeleteRole = can("Role_Management", "can_delete_role");
  // Whether *anything* on this page is editable — drives the shared bits
  // (the "view only" notice, the "system role" caveat) that don't belong to
  // just one of the three granular actions above.
  const canChangeAnything = canCreateRole || canUpdateRole || canDeleteRole;

  const [roles, setRoles] = useState<Role[] | null>(null);
  const [roleId, setRoleId] = useState<number | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [matrix, setMatrix] = useState<Record<string, PermissionRow[]> | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
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
          setRoleId(list[0].id);
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

  function toggle(row: PermissionRow) {
    if (!canUpdateRole || role?.isSystem) return;
    setPending((p) => ({ ...p, [row.permission_id]: !(p[row.permission_id] ?? row.permission) }));
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
      toast(`Permissions updated for ${role?.name ?? "role"}`);
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

  if (!can("Role_Management", "can_view_role_and_permission")) {
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
          <p>Grant or revoke what each role may view and change, across every module.</p>
        </div>
        <div className="sp" />
        {canCreateRole && (
          <button className="btn ghost" onClick={() => setShowNewRole((v) => !v)}>
            <Icon name="plus" /> New Role
          </button>
        )}
      </div>
      <hr className="gold-rule" />

      {showNewRole && (
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

      <div className="card" style={{ padding: 16 }}>
        {/* Two control rows: the role picker sits on one line with Edit
            (rename/delete now live in that modal rather than as their own
            rows), and the permission search shares the next line with the
            bulk grant/revoke and Save actions it applies to. */}
        <div className="role-ctl">
          <div style={{ flex: 1, minWidth: 0 }}>
            <label className="f">Role</label>
            <Select
              options={(roles ?? []).map((r) => ({ value: String(r.id), label: `${r.name}${r.isSystem ? " (system)" : ""}` }))}
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
            <input className="inp" placeholder="e.g. loan" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {canUpdateRole && role && !role.isSystem && (
            <>
              <button className="btn ghost" onClick={() => setAll(true)} disabled={saving}>Grant all</button>
              <button className="btn ghost" onClick={() => setAll(false)} disabled={saving}>Revoke all</button>
              <button className="btn" onClick={save} disabled={saving || Object.keys(pending).length === 0}>
                <Icon name="check" /> {saving ? "Saving…" : `Save${Object.keys(pending).length ? ` (${Object.keys(pending).length})` : ""}`}
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
                      {rows.map((row) => (
                        <label key={row.permission_id} className="ccheck perm-list-row">
                          <input
                            type="checkbox"
                            checked={row.permission}
                            onChange={() => toggle(row)}
                            disabled={!canUpdateRole || role?.isSystem}
                          />
                          <span className="mark" />
                          <span>
                            <b style={{ fontSize: 13 }}>{row.permissions.name}</b>
                            {row.permissions.description && (
                              <span className="sub" style={{ display: "block", fontSize: 11.5 }}>{row.permissions.description}</span>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
