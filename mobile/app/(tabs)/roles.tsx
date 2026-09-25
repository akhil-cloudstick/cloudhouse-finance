import React, { useEffect, useMemo, useState } from "react";
import { TAB_BAR_SPACE } from "../../src/theme/layout";
import { TopFaded } from "../../src/components/EdgeFade";
import { View, Pressable, ScrollView, Switch, StyleSheet } from "react-native";
import { ScreenContainer } from "../../src/components/ScreenContainer";
import { Card } from "../../src/components/Card";
import { ThemedText } from "../../src/components/ThemedText";
import { GoldTextInput } from "../../src/components/GoldTextInput";
import { GoldButton } from "../../src/components/GoldButton";
import { BottomSheetModal } from "../../src/components/BottomSheetModal";
import { Icon } from "../../src/components/Icon";
import { colors } from "../../src/theme/colors";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useAuth } from "../../src/auth/AuthContext";
import { useDebouncedValue } from "../../src/hooks/useDebouncedValue";
import { useRefetchOnFocus, useResetOnBlur } from "../../src/hooks/useRefetchOnFocus";
import { ApiError } from "../../src/api/client";
import { Loading } from "../../src/components/Loading";
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

// Mobile port of frontend/modules/roles/components/RolesPermissions.tsx —
// same role picker + permission-matrix-by-module shape, same three granular
// gates (create/update/delete role) plus the coarser can_view_role_and_permission
// gate on the whole page, same "system role" / "view only" notices. Laid out
// as fixed top controls (role picker, search, bulk actions) over a scrolling
// list of per-module permission cards — there's no pagination here (the web
// version has none either), so this doesn't need ExpandableTable/Pager's
// sticky-header treatment, just a plain scrollable region below the fixed
// controls.
function RenameDeleteRoleSheet({
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
  const { colors } = useTheme();
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

  if (!role) return null;

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
    <BottomSheetModal visible={visible} onClose={onClose}>
      <View style={styles.sheetHeader}>
        <ThemedText variant="h3" color={colors.brandDeep}>Edit Role — {role.name}</ThemedText>
        <Pressable onPress={onClose} hitSlop={10}>
          <ThemedText variant="h3" color={colors.muted}>
            ×
          </ThemedText>
        </Pressable>
      </View>
      <GoldTextInput label="Name *" value={name} onChangeText={setName} editable={canUpdate} />
      <GoldTextInput label="Description" value={desc} onChangeText={setDesc} editable={canUpdate} />
      {error ? (
        <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
          {error}
        </ThemedText>
      ) : null}
      {canUpdate ? (
        <GoldButton title={busy ? "Saving…" : "Save"} onPress={onSave} loading={busy} disabled={!name.trim()} />
      ) : null}
      {canDelete ? (
        <GoldButton
          title={confirmDelete ? "Tap again to confirm delete" : "Delete role"}
          variant="outline"
          onPress={onDelete}
          disabled={busy}
          style={{ marginTop: 10, borderColor: colors.red }}
        />
      ) : null}
    </BottomSheetModal>
  );
}

function NewRoleCard({ onCreated }: { onCreated: (role: Role) => void }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    <Card>
      <ThemedText variant="h3" style={{ marginBottom: 8 }}>
        New Role
      </ThemedText>
      <GoldTextInput label="Role name" placeholder="e.g. Regional Auditor" value={name} onChangeText={setName} />
      <GoldTextInput label="Description" placeholder="What this role is for" value={desc} onChangeText={setDesc} />
      <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 10 }}>
        A new role starts with every permission granted — revoke what it shouldn&apos;t have below, after creating it.
      </ThemedText>
      {error ? (
        <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
          {error}
        </ThemedText>
      ) : null}
      <GoldButton title={busy ? "Creating…" : "Create"} onPress={onCreate} loading={busy} disabled={!name.trim()} />
    </Card>
  );
}

export default function RolesPermissionsScreen() {
  const { colors } = useTheme();
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

  if (!canView) {
    return (
      <ScreenContainer style={{ paddingTop: 28 }}>
        <Card style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
          <Icon name="shield" size={18} color={colors.muted} />
          <ThemedText variant="small" color={colors.muted} style={{ flex: 1 }}>
            You do not have access to this page. Ask your administrator to grant the permission for it.
          </ThemedText>
        </Card>
      </ScreenContainer>
    );
  }

  const pendingCount = Object.keys(pending).length;
  const moduleEntries = Object.entries(effective ?? {});

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
          <ThemedText variant="label" color={colors.muted} style={{ flex: 1 }}>
            Role
          </ThemedText>
          {canCreateRole ? (
            <Pressable onPress={() => setShowNewRole((v) => !v)} hitSlop={8}>
              <ThemedText variant="small" color={colors.brandDeep}>
                {showNewRole ? "Cancel" : "+ New Role"}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.roleChipRow}>
          {(roles ?? []).map((r) => {
            const active = r.id === roleId;
            return (
              <Pressable key={r.id} onPress={() => setRoleId(r.id)} style={[styles.roleChip, active && { backgroundColor: colors.brandDeep, borderColor: colors.brandDeep }]}>
                <ThemedText variant="small" numberOfLines={1} color={active ? colors.bg : colors.ink}>
                  {r.name}
                  {r.isSystem ? " (system)" : ""}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>

        {(canUpdateRole || canDeleteRole) && role && !role.isSystem ? (
          <Pressable onPress={() => setEditVisible(true)} style={{ marginTop: 8, alignSelf: "flex-start" }}>
            <ThemedText variant="small" color={colors.brandDeep}>
              Edit role
            </ThemedText>
          </Pressable>
        ) : null}

        {showNewRole ? (
          <View style={{ marginTop: 12 }}>
            <NewRoleCard
              onCreated={(created) => {
                setShowNewRole(false);
                loadRoles(created.id);
              }}
            />
          </View>
        ) : null}

        <GoldTextInput
          label="Search permissions"
          placeholder="e.g. loan"
          value={search}
          onChangeText={setSearch}
          containerStyle={{ marginTop: 12 }}
        />

        {canUpdateRole && role && !role.isSystem ? (
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 4 }}>
            <View style={{ flex: 1 }}>
              <GoldButton title="Grant all" variant="outline" onPress={() => setAll(true)} disabled={saving} />
            </View>
            <View style={{ flex: 1 }}>
              <GoldButton title="Revoke all" variant="outline" onPress={() => setAll(false)} disabled={saving} />
            </View>
            <View style={{ flex: 1 }}>
              <GoldButton
                title={saving ? "Saving…" : pendingCount ? `Save (${pendingCount})` : "Save"}
                onPress={save}
                loading={saving}
                disabled={saving || pendingCount === 0}
              />
            </View>
          </View>
        ) : null}

        {role?.isSystem ? (
          <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 8 }}>
            {role.name} is a system role — its permissions cannot be changed, and it cannot be renamed or deleted.
          </ThemedText>
        ) : null}
        {!canChangeAnything ? (
          <Card style={{ flexDirection: "row", gap: 8, alignItems: "center", paddingVertical: 10 }}>
            <Icon name="shield" size={16} color={colors.muted} />
            <ThemedText variant="small" color={colors.muted} style={{ flex: 1 }}>
              You can view roles and permissions but not change them — ask an administrator.
            </ThemedText>
          </Card>
        ) : null}
        {error ? (
          <ThemedText variant="small" color={colors.red} style={{ marginBottom: 4 }}>
            {error}
          </ThemedText>
        ) : null}
      </View>

      <TopFaded>{(fade) => (
      <ScrollView
        {...fade}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: TAB_BAR_SPACE }}
      >
        {!effective && !error ? <Loading /> : null}
        {effective && moduleEntries.length === 0 ? (
          <ThemedText color={colors.muted}>No permissions match &quot;{search}&quot;.</ThemedText>
        ) : null}
        {moduleEntries.map(([mod, rows]) => (
          <Card key={mod}>
            <ThemedText variant="h3" style={{ marginBottom: 8 }}>
              {mod}
            </ThemedText>
            {rows.map((row, i) => (
              <View key={row.permission_id} style={[styles.permRow, i > 0 && styles.permRowDivider]}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <ThemedText variant="body" style={{ fontWeight: "600" }}>
                    {row.permissions.name}
                  </ThemedText>
                  {row.permissions.description ? (
                    <ThemedText variant="small" color={colors.muted}>
                      {row.permissions.description}
                    </ThemedText>
                  ) : null}
                </View>
                <Switch
                  value={row.permission}
                  onValueChange={() => toggle(row)}
                  disabled={!canUpdateRole || role?.isSystem}
                  trackColor={{ false: colors.line, true: colors.brandDeep }}
                  thumbColor={colors.card}
                />
              </View>
            ))}
          </Card>
        ))}
      </ScrollView>
      )}</TopFaded>

      <RenameDeleteRoleSheet
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
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  roleChipRow: { gap: 8, paddingVertical: 2 },
  roleChip: {
    flexShrink: 0,
    height: 34,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 14,
  },
  permRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  permRowDivider: { borderTopWidth: 1, borderTopColor: colors.line },
});
