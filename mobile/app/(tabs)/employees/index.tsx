import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
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
} from "../../../src/components/ui";
import { useServerList } from "../../../src/hooks/useServerList";
import { createEmployee, deleteEmployee, getEmployee, listEmployeesPage, updateEmployee } from "../../../src/api/employees";
import { ROLES, type Employee, type Role } from "../../../src/types/employee";
import { useAuth } from "../../../src/auth/AuthContext";
import { ApiError } from "../../../src/api/client";
import { inr } from "../../../src/lib/format";

// Employees — not drawn in the prototype; uses its Customers-list pattern
// (count line, SearchInput, .cust-row list) with the add/edit form and the
// employee detail as bottom Sheets. Search (`q`: name / code / phone) and
// paging are server-side.

/** Add / edit employee form (ports the old employees/new.tsx). */
function EmployeeFormSheet({ visible, onClose, editing }: { visible: boolean; onClose: () => void; editing: Employee | null }) {
  const queryClient = useQueryClient();
  const { employee: me } = useAuth();
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("Cashier");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(editing?.name ?? "");
    setRole(((ROLES as readonly string[]).includes(editing?.role ?? "") ? editing!.role : "Cashier") as Role);
    setPhone(editing?.phone ?? "");
    setError(null);
  }, [visible, editing]);

  const save = useMutation({
    mutationFn: () => {
      const input = { name: name.trim(), role, branchId: editing?.branchId ?? me!.branchId, phone: phone || undefined };
      return editing ? updateEmployee(editing.id, input) : createEmployee(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      if (editing) queryClient.invalidateQueries({ queryKey: ["employee", String(editing.id)] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  return (
    <Sheet visible={visible} onClose={onClose} title={editing ? "Edit Employee" : "Add Employee"} maxHeightPct={85}>
      <TextField label="Full name" value={name} onChangeText={setName} placeholder="Employee name" />
      <TextField label="Phone (login identifier)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="10-digit mobile" />
      <SelectField label="Role" value={role} options={ROLES} onChange={setRole} />
      {error ? <Txt style={{ color: C.red, fontSize: 12, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton label={editing ? "Save Changes" : "Add Employee"} onPress={() => save.mutate()} loading={save.isPending} disabled={!name.trim()} />
    </Sheet>
  );
}

/** Employee detail (ports the old employees/[id].tsx). */
function EmployeeDetailSheet({
  id,
  onClose,
  onEdit,
}: {
  id: number | null;
  onClose: () => void;
  onEdit: (e: Employee) => void;
}) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
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
          <SheetListItem first icon="edit" title="Edit employee" sub="Name, phone and role" onPress={() => onEdit(e)} />
          <SheetListItem
            icon="shield"
            title="Role permissions"
            sub={`What a ${e.role} can do`}
            onPress={() => {
              onClose();
              openPage("/roles");
            }}
          />
          <PrimaryButton
            label={confirm ? "Tap again to remove" : "Remove Employee"}
            variant="reject"
            loading={remove.isPending}
            onPress={() => (confirm ? remove.mutate() : setConfirm(true))}
            style={{ marginTop: 12 }}
          />
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

  const list = useServerList<Employee>({ key: ["employees", "list"], fetchPage: (p) => listEmployeesPage(p) });

  return (
    <Screen
      header={<FlatHeader title="Employees" subtitle="Staff accounts & roles" />}
      floating={
        <FabCorner
          label="Add employee"
          onPress={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        />
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
              { label: "View", onPress: () => setDetailId(e.id) },
              {
                label: "Edit Employee",
                primary: true,
                onPress: () => {
                  setEditing(e);
                  setFormOpen(true);
                },
              },
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
