import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AccRow,
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
} from "../../../src/components/ui";
import { useServerList } from "../../../src/hooks/useServerList";
import { createBranch, deactivateBranch, listBranchesPage, updateBranch } from "../../../src/api/branches";
import type { Branch } from "../../../src/types/branch";
import { ApiError } from "../../../src/api/client";
import { dmy } from "../../../src/lib/format";

// Branches — not drawn in the prototype; built from its list language
// (FlatHeader back, SearchInput, server-paged AccRows, FabCorner → form
// Sheet). The old [id].tsx detail's deactivate action lives on the row.

/** Add / edit branch (ports the old branches/new.tsx). */
function BranchFormSheet({ visible, onClose, editing }: { visible: boolean; onClose: () => void; editing: Branch | null }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(editing?.name ?? "");
    setCode(editing?.code ?? "");
    setAddress(editing?.address ?? "");
    setPhone(editing?.phone ?? "");
    setError(null);
  }, [visible, editing]);

  const save = useMutation({
    mutationFn: () => {
      const input = { name: name.trim(), code: code || undefined, address: address.trim(), phone: phone || undefined };
      return editing ? updateBranch(editing.id, { ...input, isActive: editing.isActive }) : createBranch(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branches"] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  return (
    <Sheet visible={visible} onClose={onClose} title={editing ? "Edit Branch" : "Add Branch"} maxHeightPct={85}>
      <TextField label="Branch name" value={name} onChangeText={setName} placeholder="e.g. MG Road" />
      <FieldRow>
        <TextField label="Code" value={code} onChangeText={setCode} placeholder="Optional" autoCapitalize="characters" />
        <TextField label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="Optional" />
      </FieldRow>
      <TextField label="Address" value={address} onChangeText={setAddress} placeholder="Full address" multiline />
      {error ? <Txt style={{ color: C.red, fontSize: 12, marginBottom: 10 }}>{error}</Txt> : null}
      <PrimaryButton
        label={editing ? "Save Changes" : "Add Branch"}
        onPress={() => save.mutate()}
        loading={save.isPending}
        disabled={!name.trim() || !address.trim()}
      />
    </Sheet>
  );
}

/** Deactivate confirmation (ports the old [id].tsx's deactivate action). */
function DeactivateSheet({ branch, onClose }: { branch: Branch | null; onClose: () => void }) {
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

  const list = useServerList<Branch>({ key: ["branches", "list"], fetchPage: (p) => listBranchesPage(p) });

  return (
    <Screen
      header={<FlatHeader title="Branches" subtitle={list.total != null ? `${list.total} branches` : "Branch details"} back />}
      floating={
        <FabCorner
          label="Add branch"
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
        keyOf={(b) => String(b.id)}
        emptyText={list.search ? "No branches match your search." : "No branches found."}
        header={<SearchInput value={list.search} onChangeText={list.setSearch} placeholder="Search by branch name, code, or address" style={{ paddingTop: 14 }} />}
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
              ...(b.isActive ? [{ label: "Deactivate", danger: true, onPress: () => setDeactivating(b) }] : []),
              {
                label: "Edit Branch",
                primary: true,
                onPress: () => {
                  setEditing(b);
                  setFormOpen(true);
                },
              },
            ]}
          />
        )}
      />

      <BranchFormSheet visible={formOpen} onClose={() => setFormOpen(false)} editing={editing} />
      <DeactivateSheet branch={deactivating} onClose={() => setDeactivating(null)} />
    </Screen>
  );
}
