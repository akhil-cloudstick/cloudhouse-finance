import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AccBtn,
  AccRow,
  Buffering,
  C,
  Card,
  CountLine,
  DetailRow,
  EmptyText,
  FabCorner,
  FieldGrid,
  FlatHeader,
  PrimaryButton,
  Screen,
  SearchInput,
  SelectField,
  ServerFlatList,
  Sheet,
  SheetListItem,
  TextField,
  Txt,
  openPage,
  toast,
} from "@/common/components/ui";
import { useServerList } from "@/common/hooks/use-server-list";
import { createEmployee, deleteEmployee, getEmployee, listEmployeesPage, updateEmployee } from "@/modules/employees/services/employeeService";
import { ROLES, type Employee } from "@/modules/employees/types/employee-types";
import { fetchRoles } from "@/modules/roles/services/roleService";
import { BranchField, useOwnBranch } from "@/modules/cash/components/EntryFormParts";
import { useAuth } from "@/common/providers/AuthProvider";
import { ApiError } from "@/common/services/httpClient";
import { inr } from "@/common/utils/format";

type EmployeeFormSheetProps = { visible: boolean; onClose: () => void; editing: Employee | null };

// Employees — not drawn in the prototype; uses its Customers-list pattern
// (count line, SearchInput, .cust-row list) with the add/edit form and the
// employee detail as bottom Sheets. Search (`q`: name / code / phone) and
// paging are server-side.

/** Add / edit employee form (ports the old employees/new.tsx). */
// Same rules as web's Employee form (EmployeeModalContent).
const NAME_RE = /^[A-Za-z][A-Za-z\s.'-]*$/;
const USERNAME_RE = /^[A-Za-z0-9._-]{3,60}$/;
// Look-alike characters (0/O, 1/l/I) are left out so a password read out to a new employee can't be mistyped.
const PW_LETTERS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const PW_DIGITS = "23456789";

/** A 10-character password with at least one letter and one digit — over the backend's 8-character minimum.
 * Handed to the employee once, to be changed — not a long-lived secret. */
function generatePassword(): string {
  const all = PW_LETTERS + PW_DIGITS;
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)];
  const chars = Array.from({ length: 10 }, () => pick(all));
  chars[Math.floor(Math.random() * 5)] = pick(PW_LETTERS);
  chars[5 + Math.floor(Math.random() * 5)] = pick(PW_DIGITS);
  return chars.join("");
}

function EmployeeFormSheet({ visible, onClose, editing }: EmployeeFormSheetProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [phone, setPhone] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(true);
  const [branch, setBranch] = useOwnBranch(null);
  const [error, setError] = useState<string | null>(null);

  // Live roles (custom ones included). A user without the role-view permission falls back to the seeded
  // list; system roles (Administrator) are hidden unless the employee already holds one.
  const roles = useQuery({ queryKey: ["roles", "employee-form"], queryFn: fetchRoles, enabled: visible, retry: false });
  const roleNames = roles.data ? roles.data.filter((r) => r.isActive).map((r) => r.name) : [...ROLES];
  const hiddenRoles = roles.data ? roles.data.filter((r) => r.isSystem).map((r) => r.name) : ["Administrator"];
  const roleOptions = (editing?.role && !roleNames.includes(editing.role) ? [...roleNames, editing.role] : roleNames).filter(
    (r) => !hiddenRoles.includes(r) || r === editing?.role
  );

  useEffect(() => {
    if (!visible) return;
    setName(editing?.name ?? "");
    setRole(editing?.role ?? "");
    setPhone(editing?.phone ?? "");
    setUsername(editing?.username ?? "");
    // On create the password is pre-filled with a generated one (shown, so it can be handed over). On edit it
    // starts blank and only changes if a new one is typed or generated.
    setPassword(editing ? "" : generatePassword());
    setShowPassword(!editing);
    setBranch(editing?.branchId ? { id: editing.branchId, name: editing.branch?.name ?? "" } : null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editing]);

  function validate(): string | null {
    const n = name.trim();
    if (n.length < 3 || !NAME_RE.test(n)) return "Please enter the employee's full name (letters only, at least 3 characters).";
    if (!role || !roleOptions.includes(role)) return "Please select a role.";
    if (!branch) return "Please select a branch.";
    if (phone && !/^\d{10}$/.test(phone)) return "Phone number must be exactly 10 digits.";
    const u = username.trim();
    if (u && !USERNAME_RE.test(u)) return "Username must be at least 3 characters (letters, numbers, dots, underscores or hyphens only).";
    if (password && password.length < 8) return "Password must be at least 8 characters.";
    return null;
  }

  const save = useMutation({
    mutationFn: () => {
      const input = {
        name: name.trim(),
        role,
        branchId: branch!.id,
        phone: phone || undefined,
        username: username.trim() || undefined,
        password: password || undefined,
      };
      if (editing) {
        return updateEmployee(editing.id, { ...input, loansProcessed: editing.loansProcessed, collections: editing.collections, followups: editing.followups, pending: editing.pending });
      }
      return createEmployee(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      if (editing) queryClient.invalidateQueries({ queryKey: ["employee", String(editing.id)] });
      toast.success(editing ? `${name.trim()} updated${password ? " — password changed" : ""}` : `${name.trim()} added as ${role}`);
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError && err.status < 500 ? err.message : "Something went wrong saving this employee. Please try again."),
  });

  return (
    <Sheet visible={visible} onClose={onClose} title={editing ? "Edit Employee" : "Add Employee"} maxHeightPct={90}>
      <TextField label="Full name *" value={name} onChangeText={setName} placeholder="e.g. Arun Kumar" maxLength={120} />
      <TextField label="Mobile number" value={phone} onChangeText={(v) => setPhone(v.replace(/\D/g, "").slice(0, 10))} keyboardType="phone-pad" placeholder="10-digit mobile" />
      <SelectField label="Role *" value={role} options={roleOptions} onChange={setRole} />
      <BranchField branch={branch} onChange={setBranch} />
      <TextField label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" placeholder="Login username" />
      <TextField
        label={editing ? "New password (leave blank to keep)" : "Password"}
        value={password}
        onChangeText={setPassword}
        secureTextEntry={!showPassword}
        autoCapitalize="none"
        placeholder="At least 8 characters"
      />
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
        <AccBtn label="Generate" onPress={() => { setPassword(generatePassword()); setShowPassword(true); }} />
        <AccBtn label={showPassword ? "Hide" : "Show"} onPress={() => setShowPassword((s) => !s)} />
      </View>
      {error ? <Txt style={{ color: C.red, fontSize: 12, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton
        label={editing ? "Save Changes" : "Add Employee"}
        onPress={() => {
          const v = validate();
          if (v) return setError(v);
          setError(null);
          save.mutate();
        }}
        loading={save.isPending}
        disabled={!name.trim()}
      />
    </Sheet>
  );
}

type EmployeeDetailSheetProps = {
  id: number | null;
  onClose: () => void;
  onEdit: (e: Employee) => void;
};

/** Employee detail (ports the old employees/[id].tsx). */
function EmployeeDetailSheet({
  id,
  onClose,
  onEdit,
}: EmployeeDetailSheetProps) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const { can } = useAuth();
  const canUpdate = can("Employee_Management", "can_update_employee");
  const canDelete = can("Employee_Management", "can_delete_employee");
  const canViewRoles = can("Role_Management", "can_view_role_and_permission_module");
  const q = useQuery({ queryKey: ["employee", String(id)], queryFn: () => getEmployee(id!), enabled: id != null });

  useEffect(() => setConfirm(false), [id]);

  const remove = useMutation({
    mutationFn: () => deleteEmployee(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      onClose();
    },
  });

  const e = q.data;
  return (
    <Sheet visible={id != null} onClose={onClose} title={e?.name ?? "Employee"} maxHeightPct={85}>
      {q.isLoading ? (
        <Buffering block />
      ) : q.isError || !e ? (
        <EmptyText>Could not load this employee.</EmptyText>
      ) : (
        <>
          <Card style={{ marginHorizontal: 0 }}>
            <DetailRow first k="Employee ID" v={e.code} />
            <DetailRow k="Role" v={e.role} />
            <DetailRow k="Branch" v={e.branch?.name ?? "—"} />
            <DetailRow k="Phone" v={e.phone ?? "No phone set"} />
            {e.username ? <DetailRow k="Username" v={e.username} /> : null}
          </Card>
          <FieldGrid
            style={{ marginTop: 12 }}
            items={[
              { k: "Loans processed", v: String(e.loansProcessed ?? 0) },
              { k: "Collections", v: inr(e.collections) },
              { k: "Follow-ups", v: String(e.followups ?? 0) },
              { k: "Pending", v: String(e.pending ?? 0) },
            ]}
          />
          {canUpdate ? <SheetListItem first icon="edit" title="Edit employee" sub="Name, phone and role" onPress={() => onEdit(e)} /> : null}
          {canViewRoles ? (
            <SheetListItem
              first={!canUpdate}
              icon="shield"
              title="Role permissions"
              sub={`What a ${e.role} can do`}
              onPress={() => {
                onClose();
                openPage("/roles");
              }}
            />
          ) : null}
          {canDelete ? (
            <PrimaryButton
              label={confirm ? "Tap again to remove" : "Remove Employee"}
              variant="reject"
              loading={remove.isPending}
              onPress={() => (confirm ? remove.mutate() : setConfirm(true))}
              style={{ marginTop: 12 }}
            />
          ) : null}
          {remove.isError ? (
            <Txt style={{ color: C.red, fontSize: 12, marginTop: 8 }}>
              {remove.error instanceof ApiError ? remove.error.message : "Could not remove employee."}
            </Txt>
          ) : null}
        </>
      )}
    </Sheet>
  );
}

export default function EmployeesScreen() {
  const [detailId, setDetailId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const { can } = useAuth();
  const canCreate = can("Employee_Management", "can_create_employee");
  const canUpdate = can("Employee_Management", "can_update_employee");

  const list = useServerList<Employee>({ key: ["employees", "list"], fetchPage: (p) => listEmployeesPage(p) });

  return (
    <Screen
      header={<FlatHeader title="Employees" subtitle="Staff accounts & roles" />}
      floating={
        canCreate ? (
          <FabCorner
            label="Add employee"
            onPress={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          />
        ) : undefined
      }
    >
      <ServerFlatList
        list={list}
        items={list.items}
        keyOf={(e) => String(e.id)}
        emptyText={list.search ? "No employees match your search." : "No employees found."}
        header={
          <>
            <CountLine>{list.total != null ? `${list.total} employees` : " "}</CountLine>
            <SearchInput value={list.search} onChangeText={list.setSearch} placeholder="Search by employee name, ID, or phone" />
          </>
        }
        renderItem={(e, i) => (
          <AccRow
            defaultOpen={i === 0}
            id={e.code || undefined}
            name={e.name}
            sub={e.branch?.name}
            status={e.role}
            statusTone="info"
            details={[
              { k: "Phone", v: e.phone || "—" },
              { k: "Email", v: e.email || "—" },
              { k: "Username", v: e.username || "—" },
              { k: "Loans processed", v: String(e.loansProcessed ?? 0) },
            ]}
            actions={[
              { label: "View", primary: !canUpdate, onPress: () => setDetailId(e.id) },
              ...(canUpdate
                ? [
                    {
                      label: "Edit Employee",
                      primary: true,
                      onPress: () => {
                        setEditing(e);
                        setFormOpen(true);
                      },
                    },
                  ]
                : []),
            ]}
          />
        )}
      />

      <EmployeeDetailSheet
        id={detailId}
        onClose={() => setDetailId(null)}
        onEdit={(e) => {
          setEditing(e);
          setFormOpen(true);
        }}
      />
      <EmployeeFormSheet visible={formOpen} onClose={() => setFormOpen(false)} editing={editing} />
    </Screen>
  );
}
