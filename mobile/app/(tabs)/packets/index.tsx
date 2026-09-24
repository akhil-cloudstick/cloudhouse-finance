import React, { useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { Icon } from "../../../src/components/Icon";
import { ChipSelect } from "../../../src/components/ChipSelect";
import { colors, statusColors, StatusTone } from "../../../src/theme/colors";
import { listPacketsPage, getPacketByCode } from "../../../src/api/packets";
import { getLocker } from "../../../src/api/lockers";
import { Packet } from "../../../src/types/packet";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";
import { useDebouncedValue } from "../../../src/hooks/useDebouncedValue";
import { QrScanner, parsePacketCode } from "../../../src/components/QrScanner";
import { ExpandableTable, type TableColumn } from "../../../src/components/ExpandableTable";

const PAGE_SIZE = 10;

// "Ready For Release" is a legacy stage nothing moves into any more, so it
// isn't offered as a filter.
const STATUS_FILTERS = ["All", "Packet Generated", "Locker Stored", "Bank Pledged", "Returned", "Released"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const AUCTIONED_LOAN = ["Auctioned", "Auctioned - Balance Due"];

function displayStatus(p: Packet) {
  return p.loan?.status && AUCTIONED_LOAN.includes(p.loan.status) ? "Auctioned" : p.status;
}

function toneForStatus(status: string): StatusTone {
  if (status === "Released") return "green";
  if (status === "Bank Pledged") return "info";
  if (status === "Auctioned") return "red";
  if (status === "Ready For Release" || status === "Returned") return "amber";
  return "muted";
}

function StatusPill({ status }: { status: string }) {
  const tone = statusColors(toneForStatus(status));
  return (
    <ThemedText
      variant="label"
      numberOfLines={1}
      style={{ backgroundColor: tone.bg, color: tone.fg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, alignSelf: "flex-start", fontSize: 11.5 }}
    >
      {status}
    </ThemedText>
  );
}

const PACKET_COLUMNS: TableColumn<Packet>[] = [
  { key: "code", label: "Code", render: (p) => p.code },
  { key: "loan", label: "Loan", render: (p) => p.loan?.loanNumber ?? `#${p.loanId}` },
  { key: "status", label: "Status", render: (p) => <StatusPill status={displayStatus(p)} /> },
];

// Barcode/QR lookup (`by-code`) is a separate real endpoint from the
// filtered list — both are server-side, nothing is filtered on-device.
export default function PacketsScreen() {
  const router = useRouter();
  // Arriving from a locker (`/packets?lockerId=…`) scopes this list to that
  // locker's packets instead of the branch-wide list.
  const { lockerId: lockerIdParam } = useLocalSearchParams<{ lockerId?: string }>();
  const lockerId = lockerIdParam ? Number(lockerIdParam) : undefined;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const status = statusFilter === "All" ? undefined : statusFilter;
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const q = debouncedSearch.trim() || undefined;
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  const { data, isLoading, isError, isFetching, isFetchingNextPage, fetchNextPage, hasNextPage, refetch } = useInfiniteQuery({
    queryKey: ["packets", "page", status, lockerId, q],
    queryFn: ({ pageParam = 0 }) => listPacketsPage({ status, lockerId, q, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
  });

  useRefetchOnFocus(refetch);

  const packets = data?.pages.flatMap((p) => p.items) ?? [];

  const scopedLocker = useQuery({
    queryKey: ["locker", String(lockerId)],
    queryFn: () => getLocker(lockerId!),
    enabled: lockerId != null,
  });

  // Packets only carry currentLockerId — resolve each distinct locker's code
  // once (shared cache with the locker detail screen).
  const lockerIds = Array.from(
    new Set(packets.map((p) => p.currentLockerId).filter((v): v is number => typeof v === "number" && v > 0))
  );
  const lockerLookups = useQueries({
    queries: lockerIds.map((lid) => ({ queryKey: ["locker", String(lid)], queryFn: () => getLocker(lid), staleTime: 60_000 })),
  });
  const lockerCode = (lid?: number) => {
    if (!lid) return "—";
    return lockerLookups[lockerIds.indexOf(lid)]?.data?.code ?? "…";
  };

  function packetExtraFields(p: Packet) {
    const items = (p.loan?.ornaments ?? []).reduce((sum, o) => sum + (o.quantity || 0), 0);
    return [
      { label: "Customer", value: p.loan?.customer?.name || "—" },
      { label: "Items", value: String(items) },
      { label: "Net weight", value: p.totalNetWeight != null ? `${p.totalNetWeight.toFixed(2)} g` : "—" },
      { label: "Locker", value: lockerCode(p.currentLockerId) },
    ];
  }

  async function lookupByCode(target: string) {
    setLookupError(null);
    try {
      const packet = await getPacketByCode(target);
      router.push(`/packets/${packet.id}`);
    } catch {
      setLookupError("No packet found for that code.");
    }
  }

  function onScanned(scanned: string) {
    setScannerOpen(false);
    const scannedCode = parsePacketCode(scanned);
    if (!scannedCode) {
      setLookupError("That QR code isn't a packet label.");
      return;
    }
    lookupByCode(scannedCode);
  }

  // Scrolls away with the rows (ExpandableTable's headerContent) so the
  // table's top fade sits right under the app header.
  const listHeader = (
      <View style={{ paddingTop: 20 }}>
        {lockerId != null ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <ThemedText variant="label" color={colors.brandDeep}>
              Locker {scopedLocker.data?.code ?? `#${lockerId}`}
              {scopedLocker.data ? ` · ${scopedLocker.data.occupied}/${scopedLocker.data.capacity}` : ""}
            </ThemedText>
            <ThemedText variant="small" color={colors.muted} onPress={() => router.setParams({ lockerId: undefined })}>
              Show all ×
            </ThemedText>
          </View>
        ) : null}
        <GoldTextInput
          label="Search code, loan no., customer"
          value={search}
          onChangeText={setSearch}
          right={
            <Pressable onPress={() => setScannerOpen(true)} hitSlop={12} accessibilityLabel="Scan packet label">
              <Icon name="scan" size={18} color={colors.brandDeep} />
            </Pressable>
          }
        />
        {lookupError ? (
          <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
            {lookupError}
          </ThemedText>
        ) : null}
        {/* One scrollable row instead of wrapping six chips over three lines. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <ChipSelect options={STATUS_FILTERS} value={statusFilter} onChange={setStatusFilter} />
        </ScrollView>
      </View>
  );

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <QrScanner visible={scannerOpen} onClose={() => setScannerOpen(false)} onScanned={onScanned} title="Scan Packet Label" />
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        <ExpandableTable<Packet>
          headerContent={listHeader}
          columns={PACKET_COLUMNS}
          visibleCount={PACKET_COLUMNS.length}
          data={packets}
          keyExtractor={(p) => String(p.id)}
          extraFields={packetExtraFields}
          onViewDescription={(p) => router.push(`/packets/${p.id}`)}
          emptyText={isLoading ? "Loading…" : isError ? "Could not load packets." : "No packets found."}
          refreshControl={<RefreshControl refreshing={isFetching && !isFetchingNextPage && !isLoading} onRefresh={refetch} />}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          isFetchingNextPage={isFetchingNextPage}
        />
      </View>
    </ScreenContainer>
  );
}
