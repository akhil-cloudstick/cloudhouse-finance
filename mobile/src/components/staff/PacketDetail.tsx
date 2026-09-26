import React, { useEffect, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AsyncSelect,
  Buffering,
  BtnRow2,
  C,
  Card,
  Field,
  FieldGrid,
  Input,
  MoveItem,
  PrimaryButton,
  SectionTitle,
  Sheet,
  Stepper,
  Txt,
  WarningBanner,
} from "../ui";
import { useAuth } from "../../auth/AuthContext";
import { ApiError } from "../../api/client";
import { getPacket, getPacketMovements, movePacket } from "../../api/packets";
import { getLocker, listLockersPage } from "../../api/lockers";
import { dmy, inr } from "../../lib/format";
import type { Locker } from "../../types/locker";

// Packet detail (prototype #packet-detail-modal): field grid, custody
// stepper, packet contents, actions (Check In to Locker / Repledge to Bank /
// Release Packet) and movement history. Same movement rules and permission
// gates as before — every move is POST /packets/:id/movements.

const GENERATED = "Packet Generated";
const LOCKER_STORED = "Locker Stored";
const BANK_PLEDGED = "Bank Pledged";
const RETURNED = "Returned";
const READY_FOR_RELEASE = "Ready For Release"; // legacy — nothing moves into it any more
const RELEASED = "Released";
// Loan outcomes after which the gold has left custody — the backend rejects
// every movement, so no actions are offered.
const AUCTIONED_LOAN = ["Auctioned", "Auctioned - Balance Due"];

const g = (n?: number) => `${+(n ?? 0).toFixed(2)} g`;
const errText = (msg: string | null) => (msg ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{msg}</Txt> : null);

/** Packet detail body — used by the Packets sheet and the /packets/[id]
 * route (deep links from loan detail / release review). */
export function PacketDetailBody({ packetId, onOpenLoan }: { packetId: number; onOpenLoan: (loanId: number) => void }) {
  const qc = useQueryClient();
  const { employee, can } = useAuth();
  const canMove = can("Packet_Management", "can_update_packet");
  const canBankPledge = can("Bank_Pledge_Management", "can_create_bank_pledge");
  const key = String(packetId);

  const packet = useQuery({ queryKey: ["packet", key], queryFn: () => getPacket(packetId), enabled: packetId > 0 });
  const movements = useQuery({ queryKey: ["packet", key, "movements"], queryFn: () => getPacketMovements(packetId), enabled: packetId > 0 });

  const [checkInOpen, setCheckInOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [locker, setLocker] = useState<Locker | null>(null);
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setLocker(null);
    setRemarks("");
  }, [packetId]);

  // Movement rows and the current locker carry only an id — resolve codes
  // per distinct locker (usually one or two).
  const lockerIds = Array.from(
    new Set([packet.data?.currentLockerId, ...(movements.data ?? []).map((m) => m.lockerId)].filter((v): v is number => typeof v === "number" && v > 0))
  );
  const lockerLookups = useQueries({
    queries: lockerIds.map((lid) => ({ queryKey: ["locker", String(lid)], queryFn: () => getLocker(lid), staleTime: 60_000 })),
  });
  const lockerCode = (lid?: number) => (lid ? lockerLookups[lockerIds.indexOf(lid)]?.data?.code ?? `#${lid}` : undefined);

  const move = useMutation({
    mutationFn: (input: { toStatus: string; lockerId?: number }) =>
      movePacket(packetId, { ...input, employeeId: employee!.id, remarks: remarks.trim() || undefined }),
    onSuccess: (updated) => {
      setCheckInOpen(false);
      setReleaseOpen(false);
      setRemarks("");
      setLocker(null);
      setError(null);
      qc.setQueryData(["packet", key], updated);
      qc.invalidateQueries({ queryKey: ["packet", key] });
      qc.invalidateQueries({ queryKey: ["packets"] });
      qc.invalidateQueries({ queryKey: ["lockers"] });
      qc.invalidateQueries({ queryKey: ["locker"] });
      qc.invalidateQueries({ queryKey: ["loanPacket"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not record movement."),
  });

  if (packet.isLoading) return <Buffering block />;
  if (packet.isError || !packet.data) return <Txt style={{ fontSize: 12.5, color: C.red, paddingVertical: 20 }}>Could not load this packet.</Txt>;

  const p = packet.data;
  const status = p.status;
  const loanStatus = p.loan?.status ?? "";
  const isAuctioned = AUCTIONED_LOAN.includes(loanStatus);
  const movementLocked = isAuctioned || loanStatus === "Closed" || loanStatus === "Rejected";

  // Rail shows only the stages this packet can pass through: the bank detour
  // only once it's been pledged, the legacy stage only if used.
  const visited = new Set([status, ...(movements.data ?? []).map((m) => m.toStatus)]);
  const rail = [GENERATED, LOCKER_STORED];
  if (visited.has(BANK_PLEDGED) || visited.has(RETURNED)) rail.push(BANK_PLEDGED, RETURNED);
  if (visited.has(READY_FOR_RELEASE)) rail.push(READY_FOR_RELEASE);
  rail.push(RELEASED);
  const railIndex = Math.max(0, rail.indexOf(status));

  const ornaments = p.loan?.ornaments ?? [];
  const netWeight = p.totalNetWeight ?? ornaments.reduce((sum, o) => sum + (o.netWeight || 0), 0);
  const grossWeight = p.totalGrossWeight ?? ornaments.reduce((sum, o) => sum + (o.grossWeight || 0), 0);
  const branchId = p.loan?.branchId;

  const canCheckIn = status === GENERATED || status === RETURNED;
  const canRelease = status === LOCKER_STORED || status === RETURNED || status === READY_FOR_RELEASE;
  const canRepledge = status === LOCKER_STORED && canBankPledge;
  const hasActions = canMove && !movementLocked && (canCheckIn || canRelease || canRepledge);

  const actionNote = movementLocked
    ? `${isAuctioned ? "The loan was auctioned" : "The loan is closed"} — no further packet movements are possible.`
    : status === BANK_PLEDGED
      ? "This packet's gold is pledged with a bank. Release it from Bank Pledges — that returns the packet here automatically as \"Returned\"."
      : status === RELEASED
        ? "This packet has been released to the customer — no further actions."
        : !canMove
          ? "You don't have permission to move packets."
          : null;

  return (
    <>
      <FieldGrid
        style={{ marginTop: 10, marginBottom: 14 }}
        items={[
          { k: "Loan", v: `${p.loan?.loanNumber ?? `#${p.loanId}`}${p.loan?.customer?.name ? ` · ${p.loan.customer.name}` : ""}` },
          { k: "Branch", v: p.loan?.branch?.name ?? "—" },
          { k: "Current locker", v: lockerCode(p.currentLockerId) ?? "—" },
          { k: "Gross / Net weight", v: `${g(grossWeight)} / ${g(netWeight)}` },
        ]}
      />

      <SectionTitle flush>Custody progress</SectionTitle>
      {isAuctioned ? (
        <Txt style={{ fontSize: 12, color: C.muted }}>This loan&apos;s gold was sold at auction — the packet&apos;s locker workflow no longer applies.</Txt>
      ) : (
        <Stepper steps={rail} current={railIndex} allDone={status === RELEASED} />
      )}
      {status === RETURNED ? <Txt style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Returned from the bank — check in to a locker or release.</Txt> : null}

      <SectionTitle flush style={{ marginTop: 16 }}>
        Packet contents
      </SectionTitle>
      {ornaments.length === 0 ? (
        <Txt style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>No ornaments left in this packet.</Txt>
      ) : (
        ornaments.map((o) => (
          <Card key={o.id} style={{ marginHorizontal: 0, marginBottom: 8 }}>
            <FieldGrid
              items={[
                { k: "Ornament", v: `${o.name}${o.quantity > 1 ? ` × ${o.quantity}` : ""}` },
                { k: "Purity", v: o.purity },
                { k: "Net weight", v: g(o.netWeight) },
                { k: "Gold value", v: inr(o.goldValue) },
              ]}
            />
            {o.remarks ? <Txt style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>{o.remarks}</Txt> : null}
          </Card>
        ))
      )}

      <SectionTitle flush style={{ marginTop: 16 }}>
        Actions
      </SectionTitle>
      {actionNote ? <Txt style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>{actionNote}</Txt> : null}
      {hasActions ? (
        <>
          {canCheckIn || canRepledge ? (
            <BtnRow2 style={{ marginBottom: 10 }}>
              {canCheckIn ? (
                <PrimaryButton
                  label="Check In to Locker"
                  variant="outline"
                  onPress={() => {
                    setError(null);
                    setLocker(null);
                    setRemarks("");
                    setCheckInOpen(true);
                  }}
                />
              ) : null}
              {/* A bank pledge is a real transaction recorded on the loan —
                  it moves the packet to Bank Pledged itself. */}
              {canRepledge ? <PrimaryButton label="Repledge to Bank" variant="outline" onPress={() => onOpenLoan(p.loanId)} /> : null}
            </BtnRow2>
          ) : null}
          {canRelease ? (
            <PrimaryButton
              label="Release Packet"
              variant="danger"
              style={{ marginBottom: 16 }}
              onPress={() => {
                setError(null);
                setRemarks("");
                setReleaseOpen(true);
              }}
            />
          ) : null}
        </>
      ) : null}

      <SectionTitle flush>Movement history</SectionTitle>
      <Card style={{ marginHorizontal: 0, paddingVertical: 4 }}>
        {movements.isLoading ? (
          <Buffering />
        ) : movements.data?.length ? (
          movements.data.map((m, i) => {
            // Same-status rows are partial ornament releases, not moves.
            const isRemark = !!m.fromStatus && m.fromStatus === m.toStatus;
            const title = isRemark
              ? m.remarks
                ? /^partial release/i.test(m.remarks)
                  ? m.remarks
                  : `Partial release: ${m.remarks}`
                : "Partial release"
              : m.fromStatus
                ? `${m.fromStatus} → ${m.toStatus}`
                : m.toStatus;
            const lk = lockerCode(m.lockerId);
            const sub = [lk ? `Locker ${lk}` : null, m.actorEmployeeId ? `by EMP-${m.actorEmployeeId}` : "System", !isRemark && m.remarks ? m.remarks : null]
              .filter(Boolean)
              .join(" · ");
            return <MoveItem key={m.id} first={i === 0} title={title} sub={sub} date={dmy(m.createdAt)} />;
          })
        ) : (
          <Txt style={{ fontSize: 12, color: C.muted, paddingVertical: 10 }}>No movements yet.</Txt>
        )}
      </Card>
      <PrimaryButton label="View Loan" variant="outline" onPress={() => onOpenLoan(p.loanId)} />

      <Sheet visible={checkInOpen} onClose={() => setCheckInOpen(false)} title="Check In to Locker" maxHeightPct={75}>
        {branchId == null ? <Txt style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>This loan has no branch.</Txt> : null}
        <AsyncSelect<Locker>
          label="Locker"
          placeholder="Search locker code"
          queryKey={["lockers", "picker", branchId]}
          // A locker physically lives at one branch; `status=active` returns
          // only active lockers that still have room.
          fetcher={async (q) => (await listLockersPage({ branchId, status: "active", q: q || undefined, limit: 20, offset: 0 })).items ?? []}
          selectedLabel={locker ? `${locker.code} (${locker.occupied}/${locker.capacity})` : undefined}
          onClear={() => setLocker(null)}
          onSelect={(l) => {
            setLocker(l);
            setError(null);
          }}
          keyOf={(l) => l.id}
          renderItem={(l) => ({ title: `${l.code} (${l.occupied}/${l.capacity})`, sub: l.branch?.name })}
        />
        <Field label="Remarks (optional)">
          <Input value={remarks} onChangeText={setRemarks} placeholder="Add a note" />
        </Field>
        {errText(error)}
        <PrimaryButton
          label="Confirm Check-In"
          onPress={() => locker && move.mutate({ toStatus: LOCKER_STORED, lockerId: locker.id })}
          loading={move.isPending}
          disabled={!locker}
        />
      </Sheet>

      <Sheet visible={releaseOpen} onClose={() => setReleaseOpen(false)} title="Release Packet" maxHeightPct={60}>
        <WarningBanner>This hands {p.code}&apos;s gold back to the customer. This can&apos;t be undone.</WarningBanner>
        <Field label="Remarks (optional)">
          <Input value={remarks} onChangeText={setRemarks} placeholder="Add a note" />
        </Field>
        {errText(error)}
        <BtnRow2>
          <PrimaryButton label="Cancel" variant="outline" onPress={() => setReleaseOpen(false)} />
          <PrimaryButton label="Release Packet" variant="danger" onPress={() => move.mutate({ toStatus: RELEASED })} loading={move.isPending} />
        </BtnRow2>
      </Sheet>
    </>
  );
}

/** Packet code for the sheet title (cached with the body's query). */
function usePacketCode(packetId: number, enabled: boolean) {
  const q = useQuery({ queryKey: ["packet", String(packetId)], queryFn: () => getPacket(packetId), enabled: enabled && packetId > 0 });
  return q.data?.code;
}

export function PacketDetailSheet({
  packetId,
  visible,
  onClose,
  onOpenLoan,
}: {
  packetId: number | null;
  visible: boolean;
  onClose: () => void;
  onOpenLoan: (loanId: number) => void;
}) {
  const code = usePacketCode(packetId ?? 0, visible);
  return (
    <Sheet visible={visible} onClose={onClose} title={code ?? "Packet"} maxHeightPct={88}>
      {packetId ? <PacketDetailBody packetId={packetId} onOpenLoan={onOpenLoan} /> : null}
    </Sheet>
  );
}
