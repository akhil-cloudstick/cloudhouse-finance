import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useQueries } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import {
  AccRow,
  C,
  FabCorner,
  GroupedFilter,
  PillButton,
  FlatHeader,
  PillTabs,
  PktCard,
  Screen,
  SearchInput,
  ServerFlatList,
  Txt,
  openPage,
  emptyGroupedFilter,
  gfValues,
  type GFSection,
  type GroupedFilterValue,
} from "@/common/components/ui";
import { PacketDetailSheet } from "@/modules/packets/components/PacketDetailSheet";
import { lockerStatus } from "@/modules/packets/components/lockerHelpers";
import { LockerFormSheet } from "@/modules/packets/components/LockerFormSheet";
import { LockerDetailSheet } from "@/modules/packets/components/LockerDetailSheet";
import { QrScanner, parseLabel } from "@/common/components/QrScanner";
import { useServerList } from "@/common/hooks/use-server-list";
import { usePersistedState } from "@/common/hooks/use-persisted-state";
import { useShowBranchFilter } from "@/common/hooks/use-branch-switch";
import { listBranchesPage } from "@/modules/branches/services/branchService";
import { listCustomersPage } from "@/modules/customers/services/customerService";
import { useResetOnBlur } from "@/common/hooks/use-refetch-on-focus";
import { getPacketByCode, listPackets, listPacketsPage } from "@/modules/packets/services/packetService";
import { listLoans } from "@/modules/loans/services/loanService";
import { getLocker, listLockersPage } from "@/modules/lockers/services/lockerService";
import { useAuth } from "@/common/providers/AuthProvider";
import type { Packet } from "@/modules/packets/types/packet-types";
import type { Locker } from "@/modules/lockers/types/locker-types";

// Packets & Lockers — prototype #header-packets + #page-packets, packet /
// locker filter sheets and detail sheets. One page, two tabs, each with its
// own server search (`q`) and status filter.

const TABS = ["packets", "lockers"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { packets: "Packets", lockers: "Lockers" };

// "Ready For Release" is a legacy stage nothing moves into, so not offered.
const PKT_STATUSES = ["Packet Generated", "Locker Stored", "Bank Pledged", "Returned", "Released"] as const;


const AUCTIONED_LOAN = ["Auctioned", "Auctioned - Balance Due"];

export default function PacketsScreen() {
  const params = useLocalSearchParams<{ tab?: string; lockerId?: string }>();
  const { can } = useAuth();
  const canViewPackets = can("Packet_Management", "can_view_packet_module");
  const canViewLockers = can("Locker_Management", "can_view_locker_module");
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

type PacketsTabProps = { header: React.ReactNode; lockerIdParam?: number; onOpen: (id: number) => void };

function PacketsTab({ header, lockerIdParam, onOpen }: PacketsTabProps) {
  // One grouped, multi-select filter — Status, Branch, Customer — same as web's Packets page.
  const [fv, setFv] = usePersistedState<GroupedFilterValue>("packets:filters", emptyGroupedFilter());
  const showBranchFilter = useShowBranchFilter();
  const statuses = gfValues(fv, "status");
  const branchIds = showBranchFilter ? gfValues(fv, "branch") : [];
  const customerIds = gfValues(fv, "customer");
  // Arriving with ?lockerId=… scopes the list to that locker until cleared.
  const [lockerId, setLockerId] = useState<number | undefined>(lockerIdParam);
  useEffect(() => setLockerId(lockerIdParam), [lockerIdParam]);

  // A customer belongs to one branch, so picking branches narrows the Customer list (same as web).
  const sections: GFSection[] = [
    { kind: "static", key: "status", label: "Status", options: PKT_STATUSES.map((s) => ({ value: s, label: s })) },
    ...(showBranchFilter
      ? [
          {
            kind: "async" as const,
            key: "branch",
            label: "Branch",
            fetchPage: (p: { q?: string; limit: number; offset: number }) =>
              listBranchesPage({ q: p.q, limit: p.limit, offset: p.offset }).then((r) => ({ items: r.items.map((b) => ({ value: String(b.id), label: b.name })), hasMore: r.hasMore })),
          },
        ]
      : []),
    {
      kind: "async",
      key: "customer",
      label: "Customer",
      deps: [branchIds.join(",")],
      fetchPage: (p) =>
        listCustomersPage({ q: p.q, limit: p.limit, offset: p.offset, ...(branchIds.length ? { branchIds: branchIds.map(Number) } : {}) }).then((r) => ({
          items: r.items.map((c) => ({ value: String(c.id), label: c.code ? `${c.name} (${c.code})` : c.name })),
          hasMore: r.hasMore,
        })),
    },
  ];

  const list = useServerList<Packet, { status?: string; branchId?: string; customerId?: string; lockerId?: number }>({
    key: ["packets", "list"],
    filters: {
      status: statuses.length ? statuses.join(",") : undefined,
      branchId: branchIds.length ? branchIds.join(",") : undefined,
      customerId: customerIds.length ? customerIds.join(",") : undefined,
      lockerId,
    },
    fetchPage: (p) => listPacketsPage(p),
  });

  // Packets carry only currentLockerId — resolve each distinct locker's code
  // once (shared cache with the locker sheet).
  const lockerIds = Array.from(new Set(list.items.map((p) => p.currentLockerId).filter((v): v is number => typeof v === "number" && v > 0)));
  const lookups = useQueries({ queries: lockerIds.map((lid) => ({ queryKey: ["locker", String(lid)], queryFn: () => getLocker(lid), staleTime: 60_000 })) });
  const lockerCode = (lid?: number) => (lid ? lookups[lockerIds.indexOf(lid)]?.data?.code ?? "…" : undefined);

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
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", paddingHorizontal: 18, marginBottom: 14 }}>
              <GroupedFilter title="Filters" sections={sections} value={fv} onChange={setFv} />
              {lockerId ? <PillButton label={`Locker ${lockerCode(lockerId) ?? `#${lockerId}`} ✕`} onPress={() => setLockerId(undefined)} /> : null}
            </View>
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
    </>
  );
}

type LockersTabProps = { header: React.ReactNode; onOpen: (l: Locker) => void };

function LockersTab({ header, onOpen }: LockersTabProps) {
  // Branch and Status, both multi-select — same as web's Locker filter ("Has room" = active).
  const [fv, setFv] = usePersistedState<GroupedFilterValue>("lockers:filters", emptyGroupedFilter());
  const showBranchFilter = useShowBranchFilter();
  const statuses = gfValues(fv, "status");
  const branchIds = showBranchFilter ? gfValues(fv, "branch") : [];

  const sections: GFSection[] = [
    ...(showBranchFilter
      ? [
          {
            kind: "async" as const,
            key: "branch",
            label: "Branch",
            fetchPage: (p: { q?: string; limit: number; offset: number }) =>
              listBranchesPage({ q: p.q, limit: p.limit, offset: p.offset }).then((r) => ({ items: r.items.map((b) => ({ value: String(b.id), label: b.name })), hasMore: r.hasMore })),
          },
        ]
      : []),
    {
      kind: "static",
      key: "status",
      label: "Status",
      options: [
        { value: "active", label: "Has room" },
        { value: "full", label: "Full" },
        { value: "inactive", label: "Inactive" },
      ],
    },
  ];

  const list = useServerList<Locker, { status?: string; branchId?: string }>({
    key: ["lockers", "list"],
    filters: { status: statuses.length ? statuses.join(",") : undefined, branchId: branchIds.length ? branchIds.join(",") : undefined },
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
            <View style={{ paddingHorizontal: 18, marginBottom: 14, alignItems: "flex-start" }}>
              <GroupedFilter title="Filter lockers" sections={sections} value={fv} onChange={setFv} />
            </View>
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
    </>
  );
}
