import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Buffering,
  BtnRow2,
  C,
  Card,
  CheckItem,
  ConfirmSheet,
  EmptyText,
  FlatHeader,
  NoticeBanner,
  FabMenu,
  PIcon,
  PillTabs,
  PrimaryButton,
  PScroll,
  Screen,
  SearchInput,
  SectionTitle,
  Sheet,
  SheetListItem,
  TextField,
  Txt,
  toast,
} from "@/common/components/ui";
import { useAuth } from "@/common/providers/AuthProvider";
import { NoAccess } from "@/common/components/NoAccess";
import { ApprovalWorkflowTab } from "@/modules/roles/components/ApprovalWorkflowTab";
import { useDebouncedValue } from "@/common/hooks/use-debounced-value";
import { useRefetchOnFocus, useResetOnBlur } from "@/common/hooks/use-refetch-on-focus";
import { ApiError } from "@/common/services/httpClient";
import { fetchRoles, fetchRoleMatrix, updateRolePermissions, createRole, updateRole, deleteRole } from "@/modules/roles/services/roleService";
import { ROLE_DESCRIPTION_MAX, type PermissionRef, type PermissionRow, type RoleRecord } from "@/modules/roles/types/role-types";
import { userMessage } from "@/common/services/apiErrors";
import { FieldErr } from "@/common/components/ErrorText";

// Roles & Permissions — not drawn in the prototype; mobile port of
// frontend/modules/roles/pages/RolesPermissionsPage.tsx restyled in the
// prototype's language: a role picker sheet, SearchInput (server-side `search`),
// per-module cards of CheckItem permission rows, and Sheets for new /
// edit role. Same gates: can_view_role_and_permission_module on the page, plus
// create / update / delete role; system roles are read-only.

type EditRoleSheetProps = {
  visible: boolean;
  onClose: () => void;
  role: RoleRecord | null;
  canUpdate: boolean;
  canDelete: boolean;
  onSaved: (id: number) => void;
  onDeleted: () => void;
};

// One permission checkbox. Memoized: a tap re-renders only the row(s) whose value changed.
const PermissionCheck = React.memo(function PermissionCheck({ row, sub, onToggle }: { row: PermissionRow; sub?: string; onToggle: (row: PermissionRow) => void }) {
  const press = useCallback(() => onToggle(row), [onToggle, row]);
  return <CheckItem checked={row.permission} onPress={press} title={row.permissions.name} sub={sub} />;
});

function EditRoleSheet({
  visible,
  onClose,
  role,
  canUpdate,
  canDelete,
  onSaved,
  onDeleted,
}: EditRoleSheetProps) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (visible && role) {
      setName(role.name);
      setDesc(role.description || "");
      setTried(false);
      setConfirmDelete(false);
    }
  }, [visible, role]);

  async function onSave() {
    if (!role) return;
    if (!name.trim()) return setTried(true);
    setBusy(true);
    try {
      await updateRole(role.id, name.trim(), desc.trim(), role.isActive);
      onSaved(role.id);
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not update role.");
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
    try {
      await deleteRole(role.id);
      onDeleted();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not delete role.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible && !!role} onClose={onClose} title={role ? `Edit Role — ${role.name}` : "Edit Role"} maxHeightPct={75}>
      <TextField label="Role name" value={name} onChangeText={setName} editable={canUpdate} />
      <FieldErr m={tried && !name.trim() ? "Enter the role name." : undefined} />
      <TextField label="Description" value={desc} onChangeText={setDesc} editable={canUpdate} maxLength={ROLE_DESCRIPTION_MAX} placeholder={`What this role is for (max ${ROLE_DESCRIPTION_MAX} characters)`} />
      {canUpdate ? <PrimaryButton label="Save Changes" onPress={onSave} loading={busy} /> : null}
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

type NewRoleSheetProps = { visible: boolean; onClose: () => void; onCreated: (role: RoleRecord) => void };

function NewRoleSheet({ visible, onClose, onCreated }: NewRoleSheetProps) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) setTried(false);
  }, [visible]);

  async function onCreate() {
    if (!name.trim()) return setTried(true);
    setBusy(true);
    try {
      const created = await createRole(name.trim(), desc.trim());
      setName("");
      setDesc("");
      onCreated(created);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not create role.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="New Role" maxHeightPct={75}>
      <TextField label="Role name" placeholder="e.g. Regional Auditor" value={name} onChangeText={setName} />
      <FieldErr m={tried && !name.trim() ? "Enter the role name." : undefined} />
      <TextField label="Description" placeholder={`What this role is for (max ${ROLE_DESCRIPTION_MAX} characters)`} value={desc} onChangeText={setDesc} maxLength={ROLE_DESCRIPTION_MAX} />
      <NoticeBanner>New roles get everything.</NoticeBanner>
      <PrimaryButton label="Create Role" onPress={onCreate} loading={busy} />
    </Sheet>
  );
}

// Permissions (the role matrix below) and Approval Workflow (who approves
// what — src/modules/roles/components/ApprovalWorkflowTab.tsx) are the page's two
// tabs, switched from pill tabs at the top of the page.
const PAGE_TABS = ["permissions", "workflow"] as const;
type PageTab = (typeof PAGE_TABS)[number];

export default function RolesPermissionsScreen() {
  const { employee, can, refetchPermissions } = useAuth();
  const router = useRouter();
  // Opened from an employee's "Role permissions": start on that employee's role.
  const params = useLocalSearchParams<{ role?: string; t?: string }>();
  const canView = can("Role_Management", "can_view_role_and_permission_module");
  const canCreateRole = can("Role_Management", "can_create_role");
  const canUpdateRole = can("Role_Management", "can_update_role");
  const canDeleteRole = can("Role_Management", "can_delete_role");
  const canChangeAnything = canCreateRole || canUpdateRole || canDeleteRole;

  const [roles, setRoles] = useState<RoleRecord[] | null>(null);
  const [roleId, setRoleId] = useState<number | null>(null);
  const [role, setRole] = useState<RoleRecord | null>(null);
  const [matrix, setMatrix] = useState<Record<string, PermissionRow[]> | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  // Only drives the loading placeholder; the message itself is raised as a toast.
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Record<number, boolean>>({});
  const [showNewRole, setShowNewRole] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [pageTab, setPageTab] = useState<PageTab>("permissions");

  function loadRoles(selectId?: number) {
    fetchRoles()
      .then((list) => {
        setRoles(list);
        if (selectId && list.some((r) => r.id === selectId)) {
          setRoleId(selectId);
        } else if (!roleId && list.length > 0) {
          const asked = params.role ? list.find((r) => r.name === params.role) : undefined;
          setRoleId((asked ?? list.find((r) => !r.isSystem) ?? list[0]).id);
        }
      })
      .catch((e) => {
        const m = userMessage(e, "Could not load roles — pull down to try again.");
        setError(m);
        toast.error(m);
      });
  }

  // The page stays mounted as a tab, so a later "Role permissions" tap from another employee arrives as new
  // params on an already-open page: switch to that role each time (not only when the page first loads).
  const appliedAsk = useRef("");
  useEffect(() => {
    if (!params.role || !roles) return;
    const ask = `${params.role}|${params.t ?? ""}`;
    if (appliedAsk.current === ask) return;
    const match = roles.find((r) => r.name === params.role);
    if (!match) return;
    appliedAsk.current = ask;
    setRoleId(match.id);
  }, [params.role, params.t, roles]);

  useEffect(() => {
    if (canView) loadRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  // Only the latest request may update the screen (responses can land out of order).
  const matrixSeq = useRef(0);
  function loadMatrix() {
    if (!canView || !roleId || !employee) return;
    const seq = ++matrixSeq.current;
    fetchRoleMatrix(employee.id, roleId, debouncedSearch || undefined)
      .then((res) => {
        if (seq !== matrixSeq.current) return;
        setRole(res.role);
        setMatrix(res.data);
        setError(null);
      })
      .catch((e) => {
        if (seq !== matrixSeq.current) return;
        const m = e instanceof ApiError ? e.message : "Failed to load permissions.";
        setError(m);
        toast.error(m);
      });
  }

  useEffect(() => {
    setPending({});
    loadMatrix();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleId, employee, debouncedSearch, canView]);

  useRefetchOnFocus(loadMatrix);

  useResetOnBlur(() => {
    setShowNewRole(false);
    setEditVisible(false);
    setPickerOpen(false);
  });

  const effective = useMemo(() => {
    if (!matrix) return null;
    const out: Record<string, PermissionRow[]> = {};
    for (const [mod, rows] of Object.entries(matrix)) {
      // Untouched rows keep their object, so only the row that changed re-renders.
      out[mod] = rows.map((r) => {
        const v = pending[r.permission_id] ?? r.permission;
        return v === r.permission ? r : { ...r, permission: v };
      });
    }
    return out;
  }, [matrix, pending]);

  // A related permission's on/off state including unsaved edits — it may be hidden by the search, so the
  // server's granted flag is the fallback.
  const isOn = (ref: PermissionRef) => pending[ref.permission_id] ?? ref.granted;
  // Dependents about to be switched off along with a permission (asked to confirm first).
  const [cascade, setCascade] = useState<{ row: PermissionRow; dependents: PermissionRef[] } | null>(null);

  // Records an unsaved change, or drops the entry when the value is back to what is saved, so the
  // Save count only ever counts real differences (same as the web page).
  function withValue(p: Record<number, boolean>, id: number, value: boolean, saved: boolean) {
    const next = { ...p };
    if (value === saved) delete next[id]; else next[id] = value;
    return next;
  }
  // The saved (server) state of every loaded permission; rows come from `effective`, which already has edits.
  const savedById = useMemo(() => {
    const m = new Map<number, boolean>();
    for (const rows of Object.values(matrix ?? {})) for (const r of rows) m.set(r.permission_id, r.permission);
    return m;
  }, [matrix]);

  function toggle(row: PermissionRow) {
    if (!canUpdateRole || role?.isSystem) return;
    const savedValue = savedById.get(row.permission_id) ?? row.permission;
    const current = pending[row.permission_id] ?? row.permission;
    if (!current) {
      // Switching a permission on also switches on every permission it depends on (its whole chain upward).
      const alsoOn = (row.all_parents ?? row.parents ?? []).filter((p) => !isOn(p));
      setPending((p) => {
        let next = withValue(p, row.permission_id, true, savedValue);
        for (const r of alsoOn) next = withValue(next, r.permission_id, true, r.granted);
        return next;
      });
      if (alsoOn.length > 0) toast.success("Also turned on", alsoOn.map((r) => r.label).join(", "));
      return;
    }
    const goingOff = (row.dependents ?? []).filter(isOn);
    if (goingOff.length === 0) {
      setPending((p) => withValue(p, row.permission_id, false, savedValue));
      return;
    }
    setCascade({ row, dependents: goingOff });
  }
  // A stable handler (always calls the latest toggle) so the memoized rows below aren't re-rendered on every tap.
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  const onToggle = useCallback((row: PermissionRow) => toggleRef.current(row), []);
  function confirmCascade() {
    if (!cascade) return;
    const { row, dependents } = cascade;
    setPending((p) => {
      let next = withValue(p, row.permission_id, false, savedById.get(row.permission_id) ?? true);
      for (const d of dependents) next = withValue(next, d.permission_id, false, d.granted);
      return next;
    });
    setCascade(null);
  }

  async function save() {
    if (!employee || !roleId || Object.keys(pending).length === 0) return;
    setSaving(true);
    try {
      const updates = Object.entries(pending).map(([permission_id, permission]) => ({
        permission_id: Number(permission_id),
        permission,
      }));
      await updateRolePermissions(employee.id, roleId, updates);
      toast.success("Changes saved");
      // Role names are unique per business; the employee carries the name, not the id.
      if (role?.name === employee.role) void refetchPermissions();
      setPending({});
      loadMatrix();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save — try again.");
    } finally {
      setSaving(false);
    }
  }

  // Grant All / Revoke All only mark every permission as pending; nothing is saved until Save is pressed.
  async function setAll(allowed: boolean) {
    if (!employee || !roleId || role?.isSystem || !canUpdateRole) return;
    setSaving(true);
    try {
      // A search narrows the loaded matrix, but these buttons cover every permission of the role.
      const all = debouncedSearch ? (await fetchRoleMatrix(employee.id, roleId)).data : matrix;
      if (!all) return;
      const next: Record<number, boolean> = {};
      for (const rows of Object.values(all)) for (const r of rows) if (r.permission !== allowed) next[r.permission_id] = allowed;
      setPending(next);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not load permissions — try again.");
    } finally {
      setSaving(false);
    }
  }

  const header = <FlatHeader title="Roles & Permissions" subtitle="What each role can do & who approves" />;

  if (!canView) return <NoAccess header={header} />;

  const pageTabs = <PillTabs tabs={PAGE_TABS} value={pageTab} onChange={setPageTab} labels={{ permissions: "Permissions", workflow: "Approval Workflow" }} />;
  if (pageTab === "workflow") return <ApprovalWorkflowTab header={header} tabs={pageTabs} />;

  const pendingCount = Object.keys(pending).length;
  const moduleEntries = Object.entries(effective ?? {});
  const editable = canUpdateRole && !!role && !role.isSystem;
  const selectedRole = (roles ?? []).find((r) => r.id === roleId) ?? null;
  const canEditRole = (canUpdateRole || canDeleteRole) && !!role && !role.isSystem;

  return (
    <Screen
      header={header}
      floating={
        // One corner button that opens upward into both actions — the same
        // grouping as the Bank Pledges page.
        <FabMenu
          label="Role actions"
          actions={[
            { label: "Roles", icon: "layers", onPress: () => router.push("/roles/list" as never) },
            ...(canCreateRole ? [{ label: "New Role", icon: "plus", onPress: () => setShowNewRole(true) }] : []),
            ...(canEditRole ? [{ label: "Edit Role", icon: "edit", onPress: () => setEditVisible(true) }] : []),
          ]}
        />
      }
    >
      <PScroll extraBottom={60}>
        <View style={{ paddingTop: 12 }}>{pageTabs}</View>
        {roles == null && !error ? (
          <Buffering block />
        ) : (
          // The role is picked from a rise-up list rather than a tab strip.
          <Card style={{ marginTop: 14, marginBottom: 0, paddingVertical: 4 }}>
            <SheetListItem
              first
              icon="shield"
              title={selectedRole ? `${selectedRole.name}${selectedRole.isSystem ? " (system)" : ""}` : "Select a role"}
              sub={`${(roles ?? []).length} role${(roles ?? []).length === 1 ? "" : "s"} · tap to switch`}
              onPress={() => setPickerOpen(true)}
              right={<PIcon name="chevdown" color={C.brandDeep} />}
            />
            {role?.description ? (
              <Txt numberOfLines={1} style={{ color: C.muted, fontSize: 12.5, paddingHorizontal: 14, paddingBottom: 8 }}>
                {role.description}
              </Txt>
            ) : null}
          </Card>
        )}

        <SearchInput value={search} onChangeText={setSearch} placeholder="Search permissions, e.g. loan" style={{ paddingTop: 12 }} />

        <View style={{ paddingHorizontal: 18 }}>
          {role?.isSystem ? (
            <NoticeBanner>System role — read-only.</NoticeBanner>
          ) : null}
          {!canChangeAnything ? <NoticeBanner>You can view roles and permissions but not change them — ask an administrator.</NoticeBanner> : null}
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
                <PermissionCheck
                  key={row.permission_id}
                  row={row}
                  onToggle={onToggle}
                  sub={[row.permissions.description, (row.parents ?? []).length ? `Requires ${(row.parents ?? []).map((p) => `${p.label}${isOn(p) ? "" : " (off)"}`).join(", ")}` : "", (row.soft_parents ?? []).filter((p) => !isOn(p)).length ? `Works best with ${(row.soft_parents ?? []).filter((p) => !isOn(p)).map((p) => p.label).join(", ")}` : ""].filter(Boolean).join(" — ") || undefined}
                />
              ))}
            </Card>
          </View>
        ))}
      </PScroll>

      <ConfirmSheet
        visible={!!cascade}
        onClose={() => setCascade(null)}
        title={cascade ? `Turn off ${cascade.row.permissions.name}?` : ""}
        message={cascade ? `Turning this off also turns off ${cascade.dependents.length} permission${cascade.dependents.length === 1 ? "" : "s"} that need it: ${cascade.dependents.map((d) => d.name).join(", ")}.` : ""}
        confirmLabel={cascade ? `Turn off ${cascade.dependents.length + 1}` : "Turn off"}
        danger
        onConfirm={confirmCascade}
      />
      <Sheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title="Select Role" maxHeightPct={75}>
        {/* Every role is listed — system roles (Administrator) too, shown read-only. */}
        {(roles ?? []).map((r, i) => (
          <SheetListItem
            key={r.id}
            first={i === 0}
            icon="shield"
            title={r.name}
            sub={r.isSystem ? "System role · read-only" : r.description || "Custom role"}
            onPress={() => {
              setRoleId(r.id);
              setPickerOpen(false);
            }}
            right={r.id === roleId ? <PIcon name="check" color={C.brandDeep} /> : undefined}
          />
        ))}
      </Sheet>
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
