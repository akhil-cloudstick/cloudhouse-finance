import React, { useState } from "react";
import { RefreshControl, View } from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { colors, statusColors, StatusTone } from "../../../src/theme/colors";
import { listPacketsPage, getPacketByCode } from "../../../src/api/packets";
import { Packet } from "../../../src/types/packet";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";
import { QrScanner, parsePacketCode } from "../../../src/components/QrScanner";
import { ExpandableTable, type TableColumn } from "../../../src/components/ExpandableTable";

const PAGE_SIZE = 10;

function toneForStatus(status: string): StatusTone {
  if (status === "Released") return "green";
  if (status === "Bank Pledged") return "blue";
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

// Only 3 columns exist for a packet, so all 3 stay visible — the "3 for a
// large table" rule only ever trims, and there's nothing to trim here.
const PACKET_COLUMNS: TableColumn<Packet>[] = [
  { key: "code", label: "Code", render: (p) => p.code },
  { key: "loan", label: "Loan", render: (p) => p.loan?.loanNumber ?? `#${p.loanId}` },
  { key: "status", label: "Status", render: (p) => <StatusPill status={p.status} /> },
];

function packetExtraFields(p: Packet) {
  return [
    { label: "Locker", value: p.currentLockerId ? `#${p.currentLockerId}` : "—" },
    { label: "Items", value: p.loan?.ornaments?.length ? String(p.loan.ornaments.length) : "—" },
    { label: "Updated", value: new Date(p.updatedAt).toLocaleDateString("en-IN") },
  ];
}

// Barcode/QR lookup (`by-code`) is a separate real endpoint from the
// status-filtered list — both are server-side, no client-side scanning of
// a full packet list to find a code.
export default function PacketsScreen() {
  const router = useRouter();
  // Arriving from a locker's detail screen (`/packets?lockerId=…`) scopes
  // this list to that locker's packets instead of the branch-wide list.
  const { lockerId: lockerIdParam } = useLocalSearchParams<{ lockerId?: string }>();
  const lockerId = lockerIdParam ? Number(lockerIdParam) : undefined;
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [code, setCode] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  const { data, isLoading, isError, isFetching, isFetchingNextPage, fetchNextPage, hasNextPage, refetch } = useInfiniteQuery({
    queryKey: ["packets", status, lockerId],
    queryFn: ({ pageParam = 0 }) => listPacketsPage({ status, lockerId, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
  });

  useRefetchOnFocus(refetch);

  const packets = data?.pages.flatMap((p) => p.items) ?? [];

  async function lookupByCode(rawCode?: string) {
    const target = (rawCode ?? code).trim();
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
    setCode(scannedCode);
    lookupByCode(scannedCode);
  }

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
        <GoldTextInput label="Find by barcode/QR code" value={code} onChangeText={setCode} />
        {lookupError ? (
          <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
            {lookupError}
          </ThemedText>
        ) : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <GoldButton title="Find packet" variant="outline" onPress={() => lookupByCode()} disabled={!code} />
          </View>
          <View style={{ flex: 1 }}>
            <GoldButton title="Scan Label" onPress={() => setScannerOpen(true)} />
          </View>
        </View>
      </View>
      <QrScanner visible={scannerOpen} onClose={() => setScannerOpen(false)} onScanned={onScanned} title="Scan Packet Label" />
      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16 }}>
        <ExpandableTable<Packet>
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
