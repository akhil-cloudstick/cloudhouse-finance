import React, { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import {
  Buffering,
  BtnRow2,
  C,
  Card,
  CheckItem,
  EmptyText,
  FlatHeader,
  NoticeBanner,
  PillButton,
  PillTabs,
  PrimaryButton,
  PScroll,
  Screen,
  SearchInput,
  SectionTitle,
  Sheet,
  TextField,
  Txt,
} from "../../src/components/ui";
import { useAuth } from "../../src/auth/AuthContext";
import { useDebouncedValue } from "../../src/hooks/useDebouncedValue";
import { useRefetchOnFocus, useResetOnBlur } from "../../src/hooks/useRefetchOnFocus";
import { ApiError } from "../../src/api/client";
import {
  fetchRoles,
  fetchRoleMatrix,
  updateRolePermissions,
  setAllRolePermissions,
  createRole,
  updateRole,
  deleteRole,
  type PermissionRow,
  type Role,
} from "../../src/api/roles";

// Roles & Permissions — not drawn in the prototype; mobile port of
// frontend/modules/roles/components/RolesPermissions.tsx restyled in the
// prototype's language: role PillTabs, SearchInput (server-side `search`),
// per-module cards of CheckItem permission rows, and Sheets for new /
// edit role. Same gates: can_view_role_and_permission on the page, plus
// create / update / delete role; system roles are read-only.

function ErrorText({ children }: { children: React.ReactNode }) {
  return <Txt style={{ color: C.red, fontSize: 12, marginBottom: 10 }}>{children}</Txt>;
}

function EditRoleSheet({
  visible,
  onClose,
  role,
  canUpdate,
  canDelete,
  onSaved,
  onDeleted,
}: {
  visible: boolean;
  onClose: () => void;
  role: Role | null;
  canUpdate: boolean;
  canDelete: boolean;
  onSaved: (id: number) => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (visible && role) {
      setName(role.name);
      setDesc(role.description || "");
      setError(null);
      setConfirmDelete(false);
    }
  }, [visible, role]);

  async function onSave() {
    if (!role || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await updateRole(role.id, name.trim(), desc.trim(), role.isActive);
      onSaved(role.id);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not update role.");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!role) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteRole(role.id);
      onDeleted();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not delete role.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible && !!role} onClose={onClose} title={role ? `Edit Role — ${role.name}` : "Edit Role"} maxHeightPct={75}>
      <TextField label="Role name" value={name} onChangeText={setName} editable={canUpdate} />
      <TextField label="Description" value={desc} onChangeText={setDesc} editable={canUpdate} />
      {error ? <ErrorText>{error}</ErrorText> : null}
      {canUpdate ? <PrimaryButton label="Save Changes" onPress={onSave} loading={busy} disabled={!name.trim()} /> : null}
      {canDelete ? (
        <PrimaryButton
          label={confirmDelete ? "Tap again to confirm delete" : "Delete Role"}
          variant="reject"
          onPress={onDelete}
          disabled={busy}
          style={{ marginTop: 10 }}
        />
      ) : null}
    </Sheet>
  );
}

function NewRoleSheet({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: (role: Role) => void }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) setError(null);
  }, [visible]);

  async function onCreate() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createRole(name.trim(), desc.trim());
      setName("");
      setDesc("");
      onCreated(created);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create role.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="New Role" maxHeightPct={75}>
      <TextField label="Role name" placeholder="e.g. Regional Auditor" value={name} onChangeText={setName} />
      <TextField label="Description" placeholder="What this role is for" value={desc} onChangeText={setDesc} />
      <NoticeBanner>A new role starts with every permission granted — revoke what it shouldn&apos;t have after creating it.</NoticeBanner>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <PrimaryButton label="Create Role" onPress={onCreate} loading={busy} disabled={!name.trim()} />
    </Sheet>
  );
}

export default function RolesPermissionsScreen() {
  const { employee, can } = useAuth();
  const canView = can("Role_Management", "can_view_role_and_permission");
  const canCreateRole = can("Role_Management", "can_create_role");
  const canUpdateRole = can("Role_Management", "can_update_role");
  const canDeleteRole = can("Role_Management", "can_delete_role");
  const canChangeAnything = canCreateRole || canUpdateRole || canDeleteRole;

  const [roles, setRoles] = useState<Role[] | null>(null);
  const [roleId, setRoleId] = useState<number | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [matrix, setMatrix] = useState<Record<string, PermissionRow[]> | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Record<number, boolean>>({});
  const [showNewRole, setShowNewRole] = useState(false);
  const [editVisible, setEditVisible] = useState(false);

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
    if (canView) loadRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  function loadMatrix() {
    if (!roleId || !employee) return;
    fetchRoleMatrix(employee.id, roleId, debouncedSearch || undefined)
      .then((res) => {
        setRole(res.role);
        setMatrix(res.data);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load permissions."));
  }

  useEffect(() => {
    setPending({});
    loadMatrix();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleId, employee, debouncedSearch]);

  useRefetchOnFocus(loadMatrix);

  useResetOnBlur(() => {
    setShowNewRole(false);
    setEditVisible(false);
  });

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
    setError(null);
    try {
      const updates = Object.entries(pending).map(([permission_id, permission]) => ({
        permission_id: Number(permission_id),
        permission,
      }));
      await updateRolePermissions(employee.id, roleId, updates);
      setPending({});
      loadMatrix();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save — try again.");
    } finally {
      setSaving(false);
    }
  }

  async function setAll(allowed: boolean) {
    if (!employee || !roleId || role?.isSystem || !canUpdateRole) return;
    setSaving(true);
    setError(null);
    try {
      await setAllRolePermissions(employee.id, roleId, allowed);
      setPending({});
      loadMatrix();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save — try again.");
    } finally {
      setSaving(false);
    }
  }

  const header = <FlatHeader title="Roles & Permissions" subtitle="What each role can do" back />;

  if (!canView) {
    return (
      <Screen header={header}>
        <PScroll contentContainerStyle={{ paddingTop: 16, paddingHorizontal: 18 }}>
          <NoticeBanner>You do not have access to this page. Ask your administrator to grant the permission for it.</NoticeBanner>
        </PScroll>
      </Screen>
    );
  }

  const pendingCount = Object.keys(pending).length;
  const moduleEntries = Object.entries(effective ?? {});
  const editable = canUpdateRole && !!role && !role.isSystem;
  const roleKeys = (roles ?? []).map((r) => String(r.id));
  const roleLabels = Object.fromEntries((roles ?? []).map((r) => [String(r.id), `${r.name}${r.isSystem ? " (system)" : ""}`]));

  return (
    <Screen header={header}>
      <PScroll>
        {roles == null && !error ? (
          <Buffering block />
        ) : (
          <PillTabs tabs={roleKeys} value={roleId != null ? String(roleId) : ""} onChange={(v) => setRoleId(Number(v))} labels={roleLabels} />
        )}

        {canCreateRole || ((canUpdateRole || canDeleteRole) && role && !role.isSystem) ? (
          <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 18, paddingTop: 12 }}>
            {canCreateRole ? <PillButton label="+ New Role" onPress={() => setShowNewRole(true)} /> : null}
            {(canUpdateRole || canDeleteRole) && role && !role.isSystem ? <PillButton label="Edit Role" onPress={() => setEditVisible(true)} /> : null}
          </View>
        ) : null}

        <SearchInput value={search} onChangeText={setSearch} placeholder="Search permissions, e.g. loan" style={{ paddingTop: 12 }} />

        <View style={{ paddingHorizontal: 18 }}>
          {role?.isSystem ? (
            <NoticeBanner>{role.name} is a system role — its permissions cannot be changed, and it cannot be renamed or deleted.</NoticeBanner>
          ) : null}
          {!canChangeAnything ? <NoticeBanner>You can view roles and permissions but not change them — ask an administrator.</NoticeBanner> : null}
          {error ? <ErrorText>{error}</ErrorText> : null}
          {editable ? (
            <>
              <BtnRow2 style={{ marginBottom: 10 }}>
                <PrimaryButton label="Grant All" variant="outline" onPress={() => setAll(true)} disabled={saving} />
                <PrimaryButton label="Revoke All" variant="outline" onPress={() => setAll(false)} disabled={saving} />
              </BtnRow2>
              <PrimaryButton
                label={pendingCount ? `Save Changes (${pendingCount})` : "Save Changes"}
                onPress={save}
                loading={saving}
                disabled={pendingCount === 0}
              />
            </>
          ) : null}
        </View>

        {!effective && !error ? <Buffering block /> : null}
        {effective && moduleEntries.length === 0 ? <EmptyText>No permissions match &quot;{search}&quot;.</EmptyText> : null}
        {moduleEntries.map(([mod, rows]) => (
          <View key={mod}>
            <SectionTitle>{mod.replace(/_/g, " ")}</SectionTitle>
            <Card style={{ paddingBottom: 8 }}>
              {rows.map((row) => (
                <CheckItem
                  key={row.permission_id}
                  checked={row.permission}
                  onPress={() => toggle(row)}
                  title={row.permissions.name}
                  sub={row.permissions.description || undefined}
                />
              ))}
            </Card>
          </View>
        ))}
      </PScroll>

      <NewRoleSheet
        visible={showNewRole}
        onClose={() => setShowNewRole(false)}
        onCreated={(created) => {
          setShowNewRole(false);
          loadRoles(created.id);
        }}
      />
      <EditRoleSheet
        visible={editVisible}
        onClose={() => setEditVisible(false)}
        role={role}
        canUpdate={canUpdateRole}
        canDelete={canDeleteRole}
        onSaved={(id) => loadRoles(id)}
        onDeleted={() => {
          setRoleId(null);
          setRole(null);
          setMatrix(null);
          loadRoles();
        }}
      />
    </Screen>
  );
}
