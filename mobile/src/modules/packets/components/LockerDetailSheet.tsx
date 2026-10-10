import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AccBtn, ActItem, Buffering, C, Card, FieldGrid, PrimaryButton, SectionTitle, Sheet, Txt } from "@/common/components/ui";
import { useAuth } from "@/common/providers/AuthProvider";
import { ApiError } from "@/common/services/httpClient";
import { deleteLocker, getLocker } from "@/modules/lockers/services/lockerService";
import { listPacketsPage } from "@/modules/packets/services/packetService";
import { PAGE_SIZE } from "@/common/hooks/use-server-list";
import type { Locker } from "@/modules/lockers/types/locker-types";
import { lockerStatus, errText } from "./lockerHelpers";

type LockerDetailSheetProps = {
  locker: Locker | null;
  visible: boolean;
  onClose: () => void;
  onOpenPacket: (packetId: number) => void;
  onEdit: (l: Locker) => void;
};

export function LockerDetailSheet({
  locker,
  visible,
  onClose,
  onOpenPacket,
  onEdit,
}: LockerDetailSheetProps) {
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
