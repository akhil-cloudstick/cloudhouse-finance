"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/common/components/Toast";
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

/* The permissions admin screen — one toggle per permission, grouped by
 * module, for whichever role is selected, plus role create/rename/delete.
 * Follows the house role-permission standard's §7.2/§7.3/§4. Reachable from
 * its own nav entry (Administration → Roles & Permissions), not a modal —
 * there's enough going on here (role list, search, a full permission
 * matrix) to want the room a page gives. */
export function RolesPermissions() {
  const { employee, can } = useAuth();
  const toast = useToast();

  const canCreateRole = can("Role_Management", "can_create_role");
  const canUpdateRole = can("Role_Management", "can_update_role");
  const canDeleteRole = can("Role_Management", "can_delete_role");
  const canChangePermission = can("Role_Management", "can_change_role_permission");
  // Whether *anything* on this page is editable — drives the shared bits
  // (the "view only" notice, the "system role" caveat) that don't belong to
  // just one of the four granular actions above.
  const canChangeAnything = canCreateRole || canUpdateRole || canDeleteRole || canChangePermission;

  const [roles, setRoles] = useState<Role[] | null>(null);
  const [roleId, setRoleId] = useState<number | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [matrix, setMatrix] = useState<Record<string, PermissionRow[]> | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Record<number, boolean>>({});

  // New/rename-role inline form state.
  const [showNewRole, setShowNewRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDesc, setNewRoleDesc] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [renameDesc, setRenameDesc] = useState("");

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
        setRenameName(res.role.name);
        setRenameDesc(res.role.description);
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
    if (!canChangePermission || role?.isSystem) return;
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
    if (!employee || !roleId || role?.isSystem || !canChangePermission) return;
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

  async function onRenameRole() {
    if (!role || !renameName.trim()) return;
    setSaving(true);
    try {
      await updateRole(role.id, renameName.trim(), renameDesc.trim(), role.isActive);
      toast(`Role "${renameName.trim()}" saved`);
      setRenaming(false);
      loadRoles(role.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not update role.");
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteRole() {
    if (!role) return;
    if (!confirm(`Delete role "${role.name}"? This cannot be undone.`)) return;
    setSaving(true);
    try {
      await deleteRole(role.id);
      toast(`Role "${role.name}" deleted`);
      setRoleId(null);
      loadRoles();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not delete role.");
    } finally {
      setSaving(false);
    }
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
        <div className="frow" style={{ gap: 10, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label className="f">Role</label>
            <Select
              options={(roles ?? []).map((r) => ({ value: String(r.id), label: `${r.name}${r.isSystem ? " (system)" : ""}` }))}
              value={roleId != null ? String(roleId) : ""}
              onChange={(v) => setRoleId(Number(v))}
              disabled={!roles}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label className="f">Search permissions</label>
            <input className="inp" placeholder="e.g. loan" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {canUpdateRole && role && !role.isSystem && (
            <button className="btn ghost" onClick={() => setRenaming((v) => !v)}>Rename</button>
          )}
          {canDeleteRole && role && !role.isSystem && (
            <button className="btn ghost" style={{ color: "var(--red)" }} onClick={onDeleteRole} disabled={saving}>Delete</button>
          )}
        </div>

        {renaming && role && (
          <div className="frow" style={{ gap: 10, marginTop: 12 }}>
            <div style={{ flex: 1 }}>
              <label className="f">Name</label>
              <input className="inp" value={renameName} onChange={(e) => setRenameName(e.target.value)} />
            </div>
            <div style={{ flex: 2 }}>
              <label className="f">Description</label>
              <input className="inp" value={renameDesc} onChange={(e) => setRenameDesc(e.target.value)} />
            </div>
            <button className="btn" onClick={onRenameRole} disabled={saving || !renameName.trim()}>Save</button>
          </div>
        )}

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
            {canChangePermission && !role?.isSystem && (
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <button className="btn ghost sm" onClick={() => setAll(true)} disabled={saving}>Grant all</button>
                <button className="btn ghost sm" onClick={() => setAll(false)} disabled={saving}>Revoke all</button>
                <div className="sp" />
                <button className="btn" onClick={save} disabled={saving || Object.keys(pending).length === 0}>
                  <Icon name="check" /> {saving ? "Saving…" : `Save${Object.keys(pending).length ? ` (${Object.keys(pending).length})` : ""}`}
                </button>
              </div>
            )}
            {Object.entries(effective).length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: 13 }}>No permissions match &quot;{search}&quot;.</p>
            )}
            <div className="grid" style={{ gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 24 }}>
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
                            disabled={!canChangePermission || role?.isSystem}
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
