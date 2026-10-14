import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AccRow,
  ChipToggle,
  Field,
  C,
  FabCorner,
  FieldRow,
  FlatHeader,
  PrimaryButton,
  Screen,
  SearchInput,
  ServerFlatList,
  Sheet,
  TextField,
  Txt,
  openPage,
} from "@/common/components/ui";
import { useServerList } from "@/common/hooks/use-server-list";
import { createBranch, deactivateBranch, listBranchesPage, updateBranch } from "@/modules/branches/services/branchService";
import type { Branch } from "@/modules/branches/types/branch-types";
import { ApiError } from "@/common/services/httpClient";
import { dmy } from "@/common/utils/format";
import { useAuth } from "@/common/providers/AuthProvider";
import { useQuery } from "@tanstack/react-query";
import { getBranchQuota } from "@/modules/billing/services/billingService";

type BranchFormSheetProps = { visible: boolean; onClose: () => void; editing: Branch | null };

// Branches — not drawn in the prototype; built from its list language
// (FlatHeader back, SearchInput, server-paged AccRows, FabCorner → form
// Sheet). The old [id].tsx detail's deactivate action lives on the row.

/** Add / edit branch (ports the old branches/new.tsx). */
function BranchFormSheet({ visible, onClose, editing }: BranchFormSheetProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(editing?.name ?? "");
    setCode(editing?.code ?? "");
    setAddress(editing?.address ?? "");
    setPhone(editing?.phone ?? "");
    setIsActive(editing ? editing.isActive : true);
    setError(null);
  }, [visible, editing]);

  // Same rules as web's Branch form — bad characters are filtered as you type and each field is checked on save.
  const NAME_RE = /^[A-Za-z][A-Za-z\s.'-]*$/;
  const ADDRESS_RE = /^[A-Za-z0-9\s,./#'-]*$/;
  function validate(): string | null {
    const n = name.trim();
    if (n.length < 2 || !NAME_RE.test(n)) return "Please enter a valid branch name (letters only, at least 2 characters).";
    if (!code.trim()) return "Please enter a branch code.";
    if (address.trim().length < 3) return "Please enter a branch address (at least 3 characters).";
    if (phone && !/^\d{10}$/.test(phone)) return "Phone number must be exactly 10 digits.";
    return null;
  }
  const save = useMutation({
    mutationFn: () => {
      const input = { name: name.trim(), code: code.trim().toUpperCase(), address: address.trim(), phone: phone || undefined };
      return editing ? updateBranch(editing.id, { ...input, isActive }) : createBranch(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branches"] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  return (
    <Sheet visible={visible} onClose={onClose} title={editing ? "Edit Branch" : "Add Branch"} maxHeightPct={85}>
      <TextField label="Branch name" value={name} onChangeText={(v) => (v === "" || /^[A-Za-z\s.'-]*$/.test(v)) && setName(v)} placeholder="e.g. MG Road" maxLength={80} />
      <FieldRow>
        <TextField label="Code *" value={code} onChangeText={(v) => /^[A-Za-z0-9-]*$/.test(v) && setCode(v.toUpperCase())} placeholder="e.g. KOR01" autoCapitalize="characters" maxLength={20} />
        <TextField label="Phone" value={phone} onChangeText={(v) => setPhone(v.replace(/\D/g, "").slice(0, 10))} keyboardType="phone-pad" placeholder="10 digits (optional)" />
      </FieldRow>
      <TextField label="Address" value={address} onChangeText={(v) => (v === "" || ADDRESS_RE.test(v)) && setAddress(v)} placeholder="Full address" multiline maxLength={255} />
      {editing ? (
        <Field label="Status">
          <ChipToggle options={["Active", "Inactive"] as const} value={isActive ? "Active" : "Inactive"} onChange={(v) => setIsActive(v === "Active")} />
        </Field>
      ) : null}
      {error ? <Txt style={{ color: C.red, fontSize: 12, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton
        label={editing ? "Save Changes" : "Add Branch"}
        onPress={() => {
          const v = validate();
          if (v) return setError(v);
          setError(null);
          save.mutate();
        }}
        loading={save.isPending}
        disabled={!name.trim() || !code.trim() || !address.trim()}
      />
    </Sheet>
  );
}

type DeactivateSheetProps = { branch: Branch | null; onClose: () => void };

/** Deactivate confirmation (ports the old [id].tsx's deactivate action). */
function DeactivateSheet({ branch, onClose }: DeactivateSheetProps) {
  const queryClient = useQueryClient();
  const deactivate = useMutation({
    mutationFn: () => deactivateBranch(branch!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branches"] });
      onClose();
    },
  });
  useEffect(() => deactivate.reset(), [branch]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet visible={branch != null} onClose={onClose} title="Deactivate Branch" maxHeightPct={50}>
      <Txt style={{ fontSize: 13, color: C.muted, marginBottom: 14 }}>
        {branch?.name} will be marked inactive. Existing records are kept.
      </Txt>
      {deactivate.isError ? (
        <Txt style={{ color: C.red, fontSize: 12, marginBottom: 10 }}>
          {deactivate.error instanceof ApiError ? deactivate.error.message : "Could not deactivate."}
        </Txt>
      ) : null}
      <PrimaryButton label="Deactivate Branch" variant="danger" loading={deactivate.isPending} onPress={() => deactivate.mutate()} />
    </Sheet>
  );
}

export default function BranchesScreen() {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [deactivating, setDeactivating] = useState<Branch | null>(null);
  const { can } = useAuth();
  const canCreate = can("Branch_Management", "can_create_branch");
  const canUpdate = can("Branch_Management", "can_update_branch");
  const canDelete = can("Branch_Management", "can_delete_branch");
  const canViewLedger = can("Branch_Management", "can_view_branch_ledger");

  const list = useServerList<Branch>({ key: ["branches", "list"], fetchPage: (p) => listBranchesPage(p) });
  // The plan's branch limit — a role without access to it simply sees no quota line.
  const quota = useQuery({ queryKey: ["branches", "quota"], queryFn: getBranchQuota, retry: false });
  const q = quota.data;
  const atLimit = !!q && !q.unlimited && q.used >= q.quota;

  return (
    <Screen
      header={<FlatHeader title="Branches" subtitle={list.total != null ? `${list.total} branches` : "Branch details"} />}
      floating={
        canCreate && !atLimit ? (
          <FabCorner
            label="Add branch"
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
        keyOf={(b) => String(b.id)}
        emptyText={list.search ? "No branches match your search." : "No branches found."}
        header={
          <>
            {q ? (
              <Txt style={{ fontSize: 12, color: atLimit ? C.red : C.muted, paddingHorizontal: 18, paddingTop: 12 }}>
                {q.unlimited ? `${q.used} branches · ${q.plan} plan, no limit` : `${q.used} of ${q.quota} branches used · ${q.plan} plan${atLimit ? " — upgrade to add more" : ""}`}
              </Txt>
            ) : null}
            <SearchInput value={list.search} onChangeText={list.setSearch} placeholder="Search by branch name, code, or address" style={{ paddingTop: 14 }} />
          </>
        }
        renderItem={(b, i) => (
          <AccRow
            defaultOpen={i === 0}
            id={b.code || undefined}
            name={b.name}
            sub={b.address}
            status={b.isActive ? "Active" : "Inactive"}
            details={[
              { k: "Phone", v: b.phone || "—" },
              { k: "Created", v: dmy(b.createdAt) },
              { k: "Address", v: b.address || "—" },
            ]}
            actions={[
              ...(canViewLedger ? [{ label: "Ledger", onPress: () => openPage(`/branches/${b.id}?label=${encodeURIComponent(b.name)}`) }] : []),
              ...(b.isActive && canDelete ? [{ label: "Deactivate", danger: true, onPress: () => setDeactivating(b) }] : []),
              ...(canUpdate
                ? [
                    {
                      label: "Edit Branch",
                      primary: true,
                      onPress: () => {
                        setEditing(b);
                        setFormOpen(true);
                      },
                    },
                  ]
                : []),
            ]}
          />
        )}
      />

      <BranchFormSheet visible={formOpen} onClose={() => setFormOpen(false)} editing={editing} />
      <DeactivateSheet branch={deactivating} onClose={() => setDeactivating(null)} />
    </Screen>
  );
}
