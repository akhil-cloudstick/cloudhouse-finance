import React, { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AccBtn,
  ActItem,
  AsyncSelect,
  Buffering,
  C,
  Card,
  ChipToggle,
  Field,
  FieldGrid,
  Input,
  PrimaryButton,
  SectionTitle,
  Sheet,
  Txt,
} from "../ui";
import { useAuth } from "../../auth/AuthContext";
import { ApiError } from "../../api/client";
import { createLocker, deleteLocker, getLocker, updateLocker } from "../../api/lockers";
import { listBranchesPage } from "../../api/branches";
import { listPacketsPage } from "../../api/packets";
import { PAGE_SIZE } from "../../hooks/useServerList";
import type { Locker } from "../../types/locker";
import type { Branch } from "../../types/branch";

// Locker detail (prototype #locker-detail-modal) and the create/edit locker
// form the old Lockers screen had, both as rise-up sheets.

const errText = (msg: string | null) => (msg ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{msg}</Txt> : null);
export const lockerStatus = (l: Locker) => (!l.isActive ? "Inactive" : (l.occupied ?? 0) >= l.capacity ? "Full" : "Active");

export function LockerDetailSheet({
  locker,
  visible,
  onClose,
  onOpenPacket,
  onEdit,
}: {
  locker: Locker | null;
  visible: boolean;
  onClose: () => void;
  onOpenPacket: (packetId: number) => void;
  onEdit: (l: Locker) => void;
}) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canUpdate = can("Locker_Management", "can_update_locker");
  const canDelete = can("Locker_Management", "can_delete_locker");
  const id = locker?.id ?? 0;
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setError(null);
    setConfirmDelete(false);
  }, [id, visible]);

  const detail = useQuery({ queryKey: ["locker", String(id)], queryFn: () => getLocker(id), enabled: visible && id > 0, initialData: locker ?? undefined });
  const l = detail.data ?? locker;

  // Stored packets — server-paged by lockerId, "Load more" inside the sheet.
  const packets = useInfiniteQuery({
    queryKey: ["packets", "inLocker", id],
    enabled: visible && id > 0,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => listPacketsPage({ lockerId: id, status: "Locker Stored", limit: PAGE_SIZE, offset: pageParam as number }),
    getNextPageParam: (last, all) => (last?.hasMore ? all.length * PAGE_SIZE : undefined),
  });
  const rows = packets.data?.pages.flatMap((p) => p.items ?? []) ?? [];

  const remove = useMutation({
    mutationFn: () => deleteLocker(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lockers"] });
      qc.invalidateQueries({ queryKey: ["locker"] });
      onClose();
    },
    onError: (err) => {
      setConfirmDelete(false);
      setError(err instanceof ApiError ? err.message : "Could not delete.");
    },
  });

  return (
    <Sheet visible={visible} onClose={onClose} title={l?.code ?? "Locker"} maxHeightPct={80}>
      {l ? (
        <>
          <FieldGrid
            style={{ marginTop: 10, marginBottom: 14 }}
            items={[
              { k: "Branch", v: l.branch?.name ?? "—" },
              { k: "Occupied", v: `${l.occupied ?? 0} / ${l.capacity}` },
              { k: "Status", v: lockerStatus(l) },
            ]}
          />
          <SectionTitle flush>Stored packets</SectionTitle>
          <Card style={{ marginHorizontal: 0, paddingVertical: 4 }}>
            {packets.isLoading ? (
              <Buffering />
            ) : rows.length === 0 ? (
              <Txt style={{ fontSize: 12, color: C.muted, paddingVertical: 10 }}>No packets are stored in this locker.</Txt>
            ) : (
              rows.map((p, i) => (
                <ActItem
                  key={p.id}
                  first={i === 0}
                  avatar="PK"
                  title={p.code}
                  sub={[p.loan?.loanNumber ?? `Loan #${p.loanId}`, p.loan?.customer?.name, p.totalNetWeight ? `${+p.totalNetWeight.toFixed(2)} g` : null].filter(Boolean).join(" · ")}
                  onPress={() => onOpenPacket(p.id)}
                />
              ))
            )}
            {packets.isFetchingNextPage ? <Buffering /> : packets.hasNextPage ? <AccBtn label="Load more" onPress={() => packets.fetchNextPage()} style={{ marginVertical: 8 }} /> : null}
          </Card>
          {errText(error)}
          {canUpdate ? <PrimaryButton label="Edit Locker" variant="outline" style={{ marginTop: 2 }} onPress={() => onEdit(l)} /> : null}
          {canDelete ? (
            <PrimaryButton
              label={confirmDelete ? "Tap again to delete" : "Delete Locker"}
              variant="reject"
              style={{ marginTop: 14 }}
              loading={remove.isPending}
              onPress={() => (confirmDelete ? remove.mutate() : setConfirmDelete(true))}
            />
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}

const ACTIVE_OPTIONS = ["Active", "Inactive"] as const;

/** Add / edit locker. `editing` null = create. */
export function LockerFormSheet({ visible, editing, onClose }: { visible: boolean; editing: Locker | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { employee } = useAuth();
  const [code, setCode] = useState("");
  const [capacity, setCapacity] = useState("");
  const [branch, setBranch] = useState<{ id: number; name?: string } | null>(null);
  const [active, setActive] = useState<(typeof ACTIVE_OPTIONS)[number]>("Active");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    if (editing) {
      setCode(editing.code);
      setCapacity(String(editing.capacity));
      setBranch({ id: editing.branchId, name: editing.branch?.name });
      setActive(editing.isActive ? "Active" : "Inactive");
    } else {
      setCode("");
      setCapacity("");
      setBranch(employee?.branchId ? { id: employee.branchId, name: undefined } : null);
      setActive("Active");
    }
  }, [visible, editing, employee?.branchId]);

  const capacityNum = Number(capacity);
  const capacityValid = Number.isInteger(capacityNum) && capacityNum > 0;
  // Shrinking below what's already stored would strand packets.
  const belowOccupied = !!editing && capacityValid && capacityNum < (editing.occupied ?? 0);
  const canSave = !!code.trim() && capacityValid && !belowOccupied && branch != null;

  const save = useMutation({
    mutationFn: () => {
      const input = { code: code.trim().toUpperCase(), branchId: branch!.id, capacity: capacityNum };
      return editing ? updateLocker(editing.id, { ...input, isActive: active === "Active" }) : createLocker(input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lockers"] });
      qc.invalidateQueries({ queryKey: ["locker"] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  return (
    <Sheet visible={visible} onClose={onClose} title={editing ? `Edit Locker ${editing.code}` : "Add Locker"} maxHeightPct={80}>
      <Field label="Locker code">
        <Input value={code} onChangeText={(v) => setCode(v.toUpperCase())} autoCapitalize="characters" autoCorrect={false} placeholder="e.g. LKR-04" />
      </Field>
      <Field label={editing ? `Capacity (holds ${editing.occupied ?? 0} now)` : "Capacity"}>
        <Input value={capacity} onChangeText={(v) => setCapacity(v.replace(/[^0-9]/g, ""))} keyboardType="number-pad" placeholder="e.g. 40" />
      </Field>
      {belowOccupied ? errText(`Capacity can't be lower than the ${editing!.occupied} packets already stored.`) : null}
      <AsyncSelect<Branch>
        label="Branch"
        placeholder="Search branch"
        queryKey={["branches", "locker-picker"]}
        fetcher={async (q) => (await listBranchesPage({ q: q || undefined, active: true, limit: 20, offset: 0 })).items ?? []}
        selectedLabel={branch ? branch.name ?? (branch.id === employee?.branchId ? "Your branch" : `Branch #${branch.id}`) : undefined}
        onSelect={(b) => setBranch({ id: b.id, name: b.name })}
        keyOf={(b) => b.id}
        renderItem={(b) => ({ title: b.name, sub: b.code })}
      />
      {editing ? (
        <Field label="Status">
          <ChipToggle options={ACTIVE_OPTIONS} value={active} onChange={setActive} />
        </Field>
      ) : null}
      {errText(error)}
      <PrimaryButton label={editing ? "Save Changes" : "Create Locker"} onPress={() => save.mutate()} loading={save.isPending} disabled={!canSave} />
    </Sheet>
  );
}
