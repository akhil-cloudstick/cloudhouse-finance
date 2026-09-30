import React, { useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import {
  AccRow,
  C,
  FabCorner,
  Field,
  FilterChipRow,
  FiltersBar,
  FlatHeader,
  PillTabs,
  PktCard,
  PrimaryButton,
  Screen,
  SearchInput,
  ServerFlatList,
  Sheet,
  Txt,
  openPage,
} from "../../../src/components/ui";
import { PacketDetailSheet } from "../../../src/components/staff/PacketDetail";
import { LockerDetailSheet, LockerFormSheet, lockerStatus } from "../../../src/components/staff/LockerSheets";
import { QrScanner, parseLabel } from "../../../src/components/QrScanner";
import { useServerList } from "../../../src/hooks/useServerList";
import { useResetOnBlur } from "../../../src/hooks/useRefetchOnFocus";
import { getPacketByCode, listPackets, listPacketsPage } from "../../../src/api/packets";
import { listLoans } from "../../../src/api/loans";
import { getLocker, listLockersPage } from "../../../src/api/lockers";
import { useAuth } from "../../../src/auth/AuthContext";
import type { Packet } from "../../../src/types/packet";
import type { Locker } from "../../../src/types/locker";

// Packets & Lockers — prototype #header-packets + #page-packets, packet /
// locker filter sheets and detail sheets. One page, two tabs, each with its
// own server search (`q`) and status filter.

const TABS = ["packets", "lockers"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { packets: "Packets", lockers: "Lockers" };

// "Ready For Release" is a legacy stage nothing moves into, so not offered.
const PKT_STATUSES = ["All", "Packet Generated", "Locker Stored", "Bank Pledged", "Returned", "Released"] as const;
type PktStatus = (typeof PKT_STATUSES)[number];

const LKR_STATUSES = ["All", "Active", "Full", "Inactive"] as const;
type LkrStatus = (typeof LKR_STATUSES)[number];
const LKR_PARAM: Record<LkrStatus, "active" | "full" | "inactive" | undefined> = { All: undefined, Active: "active", Full: "full", Inactive: "inactive" };

const AUCTIONED_LOAN = ["Auctioned", "Auctioned - Balance Due"];

export default function PacketsScreen() {
  const params = useLocalSearchParams<{ tab?: string; lockerId?: string }>();
  const { can } = useAuth();
  const canViewPackets = can("Packet_Management", "can_view_packet");
  const canViewLockers = can("Locker_Management", "can_view_locker");
  const canCreateLocker = can("Locker_Management", "can_create_locker");

  const [tab, setTab] = useState<Tab>(params.tab === "lockers" || !canViewPackets ? "lockers" : "packets");
  useEffect(() => {
    if (params.tab === "lockers" || params.tab === "packets") setTab(params.tab);
  }, [params.tab]);
  const visibleTabs = TABS.filter((t) => (t === "packets" ? canViewPackets : canViewLockers));

  const [packetId, setPacketId] = useState<number | null>(null);
  const [lockerDetail, setLockerDetail] = useState<Locker | null>(null);
  const [lockerForm, setLockerForm] = useState<{ open: boolean; editing: Locker | null }>({ open: false, editing: null });
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  useResetOnBlur(() => {
    setScannerOpen(false);
    setScanError(null);
  });

  const openLoan = (loanId: number) => {
    setPacketId(null);
    setLockerDetail(null);
    openPage(`/loans/${loanId}`);
  };

  // QR label → packet lookup (GET /packets/by-code), opens its sheet. A
  // loan-only label (printed before the packet existed) resolves the loan by
  // number, then opens its packet if one has since been created, else the
  // loan itself.
  async function onScanned(scanned: string) {
    setScannerOpen(false);
    const label = parseLabel(scanned);
    if (!label) {
      setScanError("That QR code isn't a packet label.");
      return;
    }
    setScanError(null);
    try {
      if (label.kind === "packet") {
        const p = await getPacketByCode(label.code);
        setTab("packets");
        setPacketId(p.id);
        return;
      }
      const loans = await listLoans({ q: label.loanNumber });
      const loan = loans.find((l) => l.loanNumber.toLowerCase() === label.loanNumber.toLowerCase());
      if (!loan) {
        setScanError("No loan found for that label.");
        return;
      }
      const packets = await listPackets({ loanId: loan.id }).catch(() => []);
      if (packets[0]) {
        setTab("packets");
        setPacketId(packets[0].id);
      } else {
        openLoan(loan.id);
      }
    } catch {
      setScanError("No packet found for that code.");
    }
  }

  const tabs = visibleTabs.length > 1 ? <PillTabs tabs={visibleTabs} value={tab} onChange={setTab} labels={TAB_LABELS} /> : null;
  const scanErr = scanError ? <Txt style={{ fontSize: 12, color: C.red, paddingHorizontal: 18, paddingTop: 8 }}>{scanError}</Txt> : null;

  return (
    <Screen
      header={
        <FlatHeader
          title="Packets & Lockers"
          subtitle="Ornament custody tracking"
          icons={canViewPackets ? [{ icon: "scan", onPress: () => setScannerOpen(true), label: "Scan packet label" }] : []}
        />
      }
      floating={tab === "lockers" && canCreateLocker ? <FabCorner label="Add locker" onPress={() => setLockerForm({ open: true, editing: null })} /> : undefined}
    >
      {tab === "packets" ? (
        <PacketsTab
          header={
            <>
              {tabs}
              {scanErr}
            </>
          }
          lockerIdParam={params.lockerId ? Number(params.lockerId) : undefined}
          onOpen={setPacketId}
        />
      ) : (
        <LockersTab
          header={
            <>
              {tabs}
              {scanErr}
            </>
          }
          onOpen={setLockerDetail}
        />
      )}

      <QrScanner visible={scannerOpen} onClose={() => setScannerOpen(false)} onScanned={onScanned} title="Scan Packet Label" />
      <PacketDetailSheet packetId={packetId} visible={packetId != null} onClose={() => setPacketId(null)} onOpenLoan={openLoan} />
      <LockerDetailSheet
        locker={lockerDetail}
        visible={!!lockerDetail}
        onClose={() => setLockerDetail(null)}
        onOpenPacket={(id) => setPacketId(id)}
        onEdit={(l) => setLockerForm({ open: true, editing: l })}
      />
      <LockerFormSheet visible={lockerForm.open} editing={lockerForm.editing} onClose={() => setLockerForm({ open: false, editing: null })} />
    </Screen>
  );
}

function PacketsTab({ header, lockerIdParam, onOpen }: { header: React.ReactNode; lockerIdParam?: number; onOpen: (id: number) => void }) {
  const [status, setStatus] = useState<PktStatus>("All");
  const [draft, setDraft] = useState<PktStatus>("All");
  const [sheetOpen, setSheetOpen] = useState(false);
  // Arriving with ?lockerId=… scopes the list to that locker until cleared.
  const [lockerId, setLockerId] = useState<number | undefined>(lockerIdParam);
  useEffect(() => setLockerId(lockerIdParam), [lockerIdParam]);

  const list = useServerList<Packet, { status?: string; lockerId?: number }>({
    key: ["packets", "list"],
    filters: { status: status === "All" ? undefined : status, lockerId },
    fetchPage: (p) => listPacketsPage(p),
  });

  // Packets carry only currentLockerId — resolve each distinct locker's code
  // once (shared cache with the locker sheet).
  const lockerIds = Array.from(new Set(list.items.map((p) => p.currentLockerId).filter((v): v is number => typeof v === "number" && v > 0)));
  const lookups = useQueries({ queries: lockerIds.map((lid) => ({ queryKey: ["locker", String(lid)], queryFn: () => getLocker(lid), staleTime: 60_000 })) });
  const lockerCode = (lid?: number) => (lid ? lookups[lockerIds.indexOf(lid)]?.data?.code ?? "…" : undefined);

  const count = (status !== "All" ? 1 : 0) + (lockerId ? 1 : 0);
  const summary = [status !== "All" ? status : null, lockerId ? `Locker ${lockerCode(lockerId) ?? `#${lockerId}`}` : null, list.total != null ? String(list.total) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <ServerFlatList
        list={list}
        items={list.items}
        keyOf={(p) => String(p.id)}
        emptyText="No packets match your search."
        header={
          <>
            {header}
            <SearchInput
              value={list.search}
              onChangeText={list.setSearch}
              placeholder="Search by loan ID, packet ID, locker ID, or customer name"
              style={{ paddingTop: 12, paddingBottom: 8 }}
            />
            <FiltersBar
              count={count}
              summary={summary || undefined}
              style={{ marginTop: 0, marginBottom: 14 }}
              onPress={() => {
                setDraft(status);
                setSheetOpen(true);
              }}
            />
          </>
        }
        renderItem={(p) => {
          const ornaments = p.loan?.ornaments ?? [];
          const items = ornaments.reduce((s, o) => s + (o.quantity || 0), 0);
          const net = p.totalNetWeight ?? ornaments.reduce((s, o) => s + (o.netWeight || 0), 0);
          const auctioned = !!p.loan?.status && AUCTIONED_LOAN.includes(p.loan.status);
          const code = lockerCode(p.currentLockerId);
          const location = p.status === "Bank Pledged" ? "With bank" : p.status === "Locker Stored" && code ? `Locker ${code}` : "—";
          return (
            <PktCard
              code={p.code}
              status={auctioned ? "Auctioned" : p.loan?.status === "Rejected" ? "Rejected" : p.status}
              loan={p.loan?.loanNumber ?? `Loan #${p.loanId}`}
              customer={p.loan?.customer?.name ?? "—"}
              items={items}
              weight={`${+net.toFixed(2)} g`}
              location={location}
              onPress={() => onOpen(p.id)}
            />
          );
        }}
      />

      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)} title="Filter Packets" maxHeightPct={65}>
        <Field label="Status">
          <FilterChipRow options={PKT_STATUSES} value={draft} onChange={setDraft} />
        </Field>
        {lockerId ? (
          <PrimaryButton label="Show All Lockers" variant="outline" style={{ marginBottom: 14 }} onPress={() => setLockerId(undefined)} />
        ) : null}
        <PrimaryButton
          label="Apply Filters"
          onPress={() => {
            setStatus(draft);
            setSheetOpen(false);
          }}
        />
      </Sheet>
    </>
  );
}

function LockersTab({ header, onOpen }: { header: React.ReactNode; onOpen: (l: Locker) => void }) {
  const [status, setStatus] = useState<LkrStatus>("All");
  const [draft, setDraft] = useState<LkrStatus>("All");
  const [sheetOpen, setSheetOpen] = useState(false);

  const list = useServerList<Locker, { status?: "active" | "full" | "inactive" }>({
    key: ["lockers", "list"],
    filters: { status: LKR_PARAM[status] },
    fetchPage: (p) => listLockersPage(p),
  });

  return (
    <>
      <ServerFlatList
        list={list}
        items={list.items}
        keyOf={(l) => String(l.id)}
        emptyText="No lockers match your search."
        header={
          <>
            {header}
            <SearchInput value={list.search} onChangeText={list.setSearch} placeholder="Search by locker ID" style={{ paddingTop: 12, paddingBottom: 8 }} />
            <FiltersBar
              count={status !== "All" ? 1 : 0}
              showCount={status !== "All"}
              summary={status !== "All" ? `${status} · ${list.total ?? list.items.length}` : undefined}
              style={{ marginTop: 0, marginBottom: 14 }}
              onPress={() => {
                setDraft(status);
                setSheetOpen(true);
              }}
            />
          </>
        }
        renderItem={(l) => {
          const st = lockerStatus(l);
          return (
            <AccRow
              id={l.code}
              name={`${l.occupied ?? 0} / ${l.capacity} occupied`}
              sub={l.branch?.name}
              status={st}
              statusTone={st === "Active" ? "active" : st === "Full" ? "overdue" : "closed"}
              onPress={() => onOpen(l)}
            />
          );
        }}
      />

      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)} title="Filter Lockers" maxHeightPct={55}>
        <Field label="Status">
          <FilterChipRow options={LKR_STATUSES} value={draft} onChange={setDraft} />
        </Field>
        <PrimaryButton
          label="Apply Filters"
          onPress={() => {
            setStatus(draft);
            setSheetOpen(false);
          }}
        />
      </Sheet>
    </>
  );
}
