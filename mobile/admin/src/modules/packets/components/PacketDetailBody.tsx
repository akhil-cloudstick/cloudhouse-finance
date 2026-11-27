import { useEffect, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { AsyncSelect, Buffering, BtnRow2, C, Card, FieldGrid, MoveItem, PrimaryButton, SectionTitle, Sheet, Stepper, Txt, WarningBanner, toast } from "@/common/components/ui";
import { FieldErr } from "@/common/components/ErrorText";
import { invalidateLoan } from "@/common/components/loanSheetKit";
import { useAuth } from "@/common/providers/AuthProvider";
import { ApiError } from "@/common/services/httpClient";
import { BankPledgeSheet } from "@/modules/loans/components/BankPledgeSheet";
import { getLoan } from "@/modules/loans/services/loanService";
import { getPacket, getPacketMovements, movePacket } from "@/modules/packets/services/packetService";
import { getLocker, listLockersPage } from "@/modules/lockers/services/lockerService";
import { dmyTime, inr } from "@/common/utils/format";
import type { Locker } from "@/modules/lockers/types/locker-types";

// Packet detail (prototype #packet-detail-modal): field grid, custody
// stepper, packet contents, actions (Check In to Locker / Repledge to Bank /
// Release Packet) and movement history. Same movement rules and permission
// gates as before — every move is POST /packets/:id/movements.

const GENERATED = "Packet Generated";
const LOCKER_STORED = "Locker Stored";
const BANK_PLEDGED = "Bank Pledged";
const RETURNED = "Returned";
const READY_FOR_RELEASE = "Ready For Release";
 // legacy — nothing moves into it any more
const RELEASED = "Released";
// Loan outcomes after which the gold has left custody — the backend rejects
// every movement, so no actions are offered.
// Same statuses the backend refuses a pledge on (web canAcceptBankPledge).
const PLEDGE_INELIGIBLE = ["Closed", "Rejected", "Closure Requested", "Pending Approval", "Auctioned", "Auctioned - Balance Due"];
const canAcceptBankPledge = (status: string, bankPledgeStatus: string) => !PLEDGE_INELIGIBLE.includes(status) && bankPledgeStatus !== "Bank Pledged";
const AUCTIONED_LOAN = ["Auctioned", "Auctioned - Balance Due"];
const g = (n?: number) => `${+(n ?? 0).toFixed(2)} g`;
type PacketDetailBodyProps = { packetId: number; onOpenLoan: (loanId: number) => void };

/** Packet detail body — used by the Packets sheet and the /packets/[id]
 * route (deep links from loan detail / release review). */
export function PacketDetailBody({ packetId, onOpenLoan }: PacketDetailBodyProps) {
  const lockersAllFull = useRef(false);
  const qc = useQueryClient();
  const { employee, can } = useAuth();
  const canMove = can("Packet_Management", "can_update_packet");
  const canBankPledge = can("Bank_Pledge_Management", "can_create_bank_pledge");
  const canUpdatePledge = can("Bank_Pledge_Management", "can_update_bank_pledge");
  const canViewLoans = can("Loan_Management", "can_view_loan_module");
  const key = String(packetId);

  const packet = useQuery({ queryKey: ["packet", key], queryFn: () => getPacket(packetId), enabled: packetId > 0 });
  const movements = useQuery({ queryKey: ["packet", key, "movements"], queryFn: () => getPacketMovements(packetId), enabled: packetId > 0 });

  const [pledgeOpen, setPledgeOpen] = useState(false);
  const loanQ = useQuery({ queryKey: ["loan", packet.data?.loanId], queryFn: () => getLoan(packet.data!.loanId), enabled: pledgeOpen && !!packet.data?.loanId });
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [pledgeBusy, setPledgeBusy] = useState(false);
  const [locker, setLocker] = useState<Locker | null>(null);
  const [lockerTried, setLockerTried] = useState(false);

  useEffect(() => {
    setLocker(null); setLockerTried(false);
  }, [packetId]);

  // Movement rows and the current locker carry only an id — resolve codes
  // per distinct locker (usually one or two).
  const lockerIds = Array.from(
    new Set([packet.data?.lockerCode ? undefined : packet.data?.currentLockerId, ...(movements.data ?? []).map((m) => m.lockerId)].filter((v): v is number => typeof v === "number" && v > 0))
  );
  const lockerLookups = useQueries({
    queries: lockerIds.map((lid) => ({ queryKey: ["locker", String(lid)], queryFn: () => getLocker(lid), staleTime: 60_000 })),
  });
  const lockerCode = (lid?: number) => (lid && lid === packet.data?.currentLockerId && packet.data?.lockerCode ? packet.data.lockerCode : lockerCode0(lid));
  const lockerCode0 = (lid?: number) => (lid ? lockerLookups[lockerIds.indexOf(lid)]?.data?.code ?? `#${lid}` : undefined);

  const move = useMutation({
    mutationFn: (input: { toStatus: string; lockerId?: number }) => {
      if (!employee) throw new Error("No signed-in employee — sign in again to move packets.");
      return movePacket(packetId, { ...input, employeeId: employee.id });
    },
    onSuccess: (updated) => {
      setCheckInOpen(false);
      setChangeOpen(false);
      setReleaseOpen(false);
      setLocker(null); setLockerTried(false);
      qc.setQueryData(["packet", key], updated);
      qc.invalidateQueries({ queryKey: ["packet", key] });
      qc.invalidateQueries({ queryKey: ["packets"] });
      qc.invalidateQueries({ queryKey: ["lockers"] });
      qc.invalidateQueries({ queryKey: ["locker"] });
      qc.invalidateQueries({ queryKey: ["loanPacket"] });
      if (packet.data?.loanId) {
        invalidateLoan(qc, packet.data.loanId);
        qc.invalidateQueries({ queryKey: ["loan", packet.data.loanId] }); // numeric-key variant used on this page
      }
      qc.invalidateQueries({ queryKey: ["loans"] });
    },
    onError: (err) => toast.error(err instanceof ApiError || (err instanceof Error && !employee) ? err.message : "Could not record movement."),
  });

  if (packet.isLoading) return <Buffering block />;
  if (packet.isError || !packet.data) return <Txt style={{ fontSize: 12.5, color: C.red, paddingVertical: 20 }}>Could not load this packet.</Txt>;

  const p = packet.data;
  const status = p.status;
  const loanClosed = p.loan?.status === "Closed";
  const loanStatus = p.loan?.status ?? "";
  const isAuctioned = AUCTIONED_LOAN.includes(loanStatus);
  const movementLocked = isAuctioned || loanStatus === "Closed" || loanStatus === "Rejected" || loanStatus === "Pending Approval";

  // Rail shows only the stages this packet can pass through: the bank detour
  // only once it's been pledged, the legacy stage only if used.
  const visited = new Set([status, ...(movements.data ?? []).map((m) => m.toStatus)]);
  const rail = [GENERATED, LOCKER_STORED];
  if (visited.has(BANK_PLEDGED) || visited.has(RETURNED)) rail.push(BANK_PLEDGED, RETURNED);
  if (visited.has(READY_FOR_RELEASE)) rail.push(READY_FOR_RELEASE);
  rail.push(RELEASED);
  const shownStatus = loanClosed ? RELEASED : status;
  const railIndex = Math.max(0, rail.indexOf(shownStatus));

  const ornaments = p.loan?.ornaments ?? [];
  const netWeight = p.totalNetWeight ?? ornaments.reduce((sum, o) => sum + (o.netWeight || 0), 0);
  const grossWeight = p.totalGrossWeight ?? ornaments.reduce((sum, o) => sum + (o.grossWeight || 0), 0);
  const branchId = p.loan?.branchId;

  const canCheckIn = status === GENERATED || status === RETURNED;
  const canRelease = status === LOCKER_STORED || status === RETURNED || status === READY_FOR_RELEASE;
  const canRepledge = status === LOCKER_STORED && canBankPledge;
  async function openPledge() {
    setPledgeBusy(true);
    try {
      const loan = await getLoan(p.loanId);
      if (!canAcceptBankPledge(loan.status ?? "", loan.bankPledgeStatus ?? "")) {
        toast.error("This loan can no longer be re-pledged to a bank.");
        return;
      }
      qc.setQueryData(["loan", p.loanId], loan);
      setPledgeOpen(true);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not load the loan — try again.");
    } finally {
      setPledgeBusy(false);
    }
  }

  // A packet whose gold is with a bank: the Bank Pledge sheet is where it is released (it returns the packet here as "Returned").
  const canReleasePledge = status === BANK_PLEDGED && canUpdatePledge && !movementLocked;
  async function openRelease() {
    setPledgeBusy(true);
    try {
      qc.setQueryData(["loan", p.loanId], await getLoan(p.loanId));
      setPledgeOpen(true);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not load the loan — try again.");
    } finally {
      setPledgeBusy(false);
    }
  }

  const hasActions = canMove && !!employee &&!movementLocked && (canCheckIn || canRelease || canRepledge);

  const actionNote = movementLocked
    ? `${isAuctioned ? "The loan was auctioned" : loanStatus === "Rejected" ? "The loan was rejected" : "The loan is closed"} — no further packet movements are possible.`
    : status === BANK_PLEDGED
      ? "This packet's gold is pledged with a bank. Release it from Bank Pledges — that returns the packet here automatically as \"Returned\"."
      : status === RELEASED
        ? "This packet has been released to the customer — no further actions."
        : !canMove
          ? "You don't have permission to move packets."
          : !employee
            ? "No signed-in employee — sign in again to move packets."
            : null;

  return (
    <>
      <FieldGrid
        style={{ marginTop: 10, marginBottom: 14 }}
        items={[
          { k: "Loan", v: `${p.loan?.loanNumber ?? `#${p.loanId}`}${p.loan?.customer?.name ? ` · ${p.loan.customer.name}` : ""}` },
          { k: "Packet status", v: shownStatus },
          { k: "Loan status", v: loanStatus || "—", color: loanStatus === "Rejected" ? C.red : undefined },
          { k: "Branch", v: p.loan?.branch?.name ?? "—" },
          { k: "Current locker", v: lockerCode(p.currentLockerId) ?? "—" },
          { k: "Gross / Net weight", v: `${g(grossWeight)} / ${g(netWeight)}` },
        ]}
      />

      <SectionTitle flush>Custody progress</SectionTitle>
      {isAuctioned ? (
        <Txt style={{ fontSize: 12, color: C.muted }}>This loan&apos;s gold was sold at auction — the packet&apos;s locker workflow no longer applies.</Txt>
      ) : (
        <Stepper steps={rail} current={railIndex} allDone={shownStatus === RELEASED} />
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
                { k: "Gross weight", v: g(o.grossWeight) },
                { k: "Net weight", v: g(o.netWeight) },
                { k: "Gold value", v: inr(o.goldValue) },
              ]}
            />
            {o.remarks ? <Txt style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>{o.remarks}</Txt> : null}
          </Card>
        ))
      )}
      {(p.releasedOrnaments ?? []).map((o) => (
        <Card key={`released-${o.id}`} style={{ marginHorizontal: 0, marginBottom: 8, opacity: 0.6 }}>
          <FieldGrid
            items={[
              { k: "Ornament", v: `${o.name}${o.quantity > 1 ? ` × ${o.quantity}` : ""}` },
              { k: "Status", v: o.releasedAt ? `Released ${dmyTime(o.releasedAt)}` : "Released to customer" },
              { k: "Gross weight", v: g(o.grossWeight) },
              { k: "Net weight", v: g(o.netWeight) },
              { k: "Gold value", v: inr(o.goldValue) },
            ]}
          />
        </Card>
      ))}

      <SectionTitle flush style={{ marginTop: 16 }}>
        Actions
      </SectionTitle>
      {actionNote ? <Txt style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>{actionNote}</Txt> : null}
      {canReleasePledge ? <PrimaryButton label="Release from Bank Pledge" variant="outline" loading={pledgeBusy} style={{ marginBottom: 14 }} onPress={openRelease} /> : null}
      {hasActions ? (
        <>
          {canCheckIn || canRepledge ? (
            <BtnRow2 style={{ marginBottom: 10 }}>
              {canCheckIn ? (
                <PrimaryButton
                  label="Check In to Locker"
                  variant="outline"
                  onPress={() => {
                    setLocker(null); setLockerTried(false);
                    setCheckInOpen(true);
                  }}
                />
              ) : null}
              {/* A bank pledge is a real transaction recorded on the loan —
                  it moves the packet to Bank Pledged itself. */}
              {canRepledge ? <PrimaryButton label="Repledge to Bank" variant="outline" loading={pledgeBusy} onPress={openPledge} /> : null}
            </BtnRow2>
          ) : null}
          {status === LOCKER_STORED ? (
            <PrimaryButton label="Change Locker" variant="outline" style={{ marginBottom: 10 }} onPress={() => { setLocker(null); setLockerTried(false); setChangeOpen(true); }} />
          ) : null}
          {canRelease ? (
            <PrimaryButton
              label="Release Packet"
              variant="danger"
              style={{ marginBottom: 16 }}
              onPress={() => {
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
            return <MoveItem key={m.id} first={i === 0} title={title} sub={sub} date={dmyTime(m.createdAt)} />;
          })
        ) : (
          <Txt style={{ fontSize: 12, color: C.muted, paddingVertical: 10 }}>No movements yet.</Txt>
        )}
      </Card>
      {canViewLoans ? <PrimaryButton label="View Loan" variant="outline" onPress={() => onOpenLoan(p.loanId)} /> : null}

      <Sheet visible={checkInOpen || changeOpen} onClose={() => { setCheckInOpen(false); setChangeOpen(false); }} title={changeOpen ? "Change Locker" : "Check In to Locker"} maxHeightPct={75}>
        {branchId == null ? <Txt style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>This loan has no branch.</Txt> : null}
        <AsyncSelect<Locker>
          label="Locker"
          placeholder="Search locker code"
          queryKey={["lockers", "picker", branchId]}
          // A locker physically lives at one branch; `status=active` returns
          // only active lockers that still have room.
          fetcher={async (q) => {
            const all = (await listLockersPage({ branchId, status: "active", q: q || undefined, limit: 20, offset: 0 })).items ?? [];
            const free = all.filter((x) => (x.occupied ?? 0) < x.capacity && x.id !== (changeOpen ? p.currentLockerId : undefined));
            lockersAllFull.current = all.length > 0 && free.length === 0;
            return free;
          }}
          emptyText={() => (lockersAllFull.current ? "All lockers full" : undefined)}
          selectedLabel={locker ? `${locker.code} (${locker.occupied}/${locker.capacity})` : undefined}
          onClear={() => setLocker(null)}
          onSelect={(l) => {
            setLocker(l);
          }}
          keyOf={(l) => l.id}
          renderItem={(l) => ({ title: `${l.code} (${l.occupied}/${l.capacity})`, sub: l.branch?.name })}
        />
        <FieldErr m={lockerTried && !locker ? "Select a locker." : undefined} />
        {/* Checking in or changing a locker takes no remarks on mobile (the web form has none either). */}
        <PrimaryButton
          label={changeOpen ? "Confirm Change" : "Confirm Check-In"}
          onPress={() => (locker ? move.mutate({ toStatus: LOCKER_STORED, lockerId: locker.id }) : setLockerTried(true))}
          loading={move.isPending}
        />
      </Sheet>

      {pledgeOpen && loanQ.data ? <BankPledgeSheet loan={loanQ.data} packetStatus={status} visible onClose={() => { setPledgeOpen(false); qc.invalidateQueries({ queryKey: ["packet", key] }); qc.invalidateQueries({ queryKey: ["packets"] }); }} /> : null}

      <Sheet visible={releaseOpen} onClose={() => setReleaseOpen(false)} title="Release Packet" maxHeightPct={60}>
        <WarningBanner>This hands {p.code}&apos;s gold back to the customer. This can&apos;t be undone.</WarningBanner>
        <BtnRow2>
          <PrimaryButton label="Cancel" variant="outline" onPress={() => setReleaseOpen(false)} />
          <PrimaryButton label="Release Packet" variant="danger" onPress={() => move.mutate({ toStatus: RELEASED })} loading={move.isPending} />
        </BtnRow2>
      </Sheet>
    </>
  );
}
