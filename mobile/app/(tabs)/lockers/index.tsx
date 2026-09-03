import React, { useState } from "react";
import { RefreshControl, View } from "react-native";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { colors, statusColors } from "../../../src/theme/colors";
import { listLockersPage, createLocker } from "../../../src/api/lockers";
import { getPacketByCode } from "../../../src/api/packets";
import { Locker } from "../../../src/types/locker";
import { useAuth } from "../../../src/auth/AuthContext";
import { ApiError } from "../../../src/api/client";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";
import { QrScanner, parsePacketCode } from "../../../src/components/QrScanner";
import { ExpandableTable, type TableColumn } from "../../../src/components/ExpandableTable";

const PAGE_SIZE = 10;

function StatusPill({ active }: { active: boolean }) {
  const tone = statusColors(active ? "green" : "muted");
  return (
    <ThemedText
      variant="label"
      style={{ backgroundColor: tone.bg, color: tone.fg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, alignSelf: "flex-start", fontSize: 11.5 }}
    >
      {active ? "Active" : "Inactive"}
    </ThemedText>
  );
}

const LOCKER_COLUMNS: TableColumn<Locker>[] = [
  { key: "code", label: "Code", render: (l) => l.code },
  { key: "capacity", label: "Capacity", render: (l) => String(l.capacity) },
  { key: "occupied", label: "Occupied", render: (l) => (l.occupied !== undefined ? String(l.occupied) : "—") },
  { key: "status", label: "Status", render: (l) => <StatusPill active={l.isActive} /> },
];

export default function LockersScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { employee } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState("");
  const [capacity, setCapacity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const { data, isLoading, isError, isFetching, isFetchingNextPage, fetchNextPage, hasNextPage, refetch } = useInfiniteQuery({
    queryKey: ["lockers"],
    queryFn: ({ pageParam = 0 }) => listLockersPage({ limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
  });

  useRefetchOnFocus(refetch);

  const lockers = data?.pages.flatMap((p) => p.items) ?? [];

  const create = useMutation({
    mutationFn: () => createLocker({ code, branchId: employee!.branchId, capacity: Number(capacity) }),
    onSuccess: () => {
      setCode("");
      setCapacity("");
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["lockers"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  // No screen currently lets staff check a packet into a locker by code —
  // that move only happens from the packet's own detail screen (its
  // "Advance packet" -> Locker Stored -> pick locker flow). Scanning a
  // packet's label here is a shortcut straight to that screen instead of
  // hunting the packet down in the list first.
  async function onScanned(scanned: string) {
    setScannerOpen(false);
    const code = parsePacketCode(scanned);
    if (!code) {
      setScanError("That QR code isn't a packet label.");
      return;
    }
    setScanError(null);
    try {
      const packet = await getPacketByCode(code);
      router.push(`/packets/${packet.id}`);
    } catch {
      setScanError("No packet found for that code.");
    }
  }

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <GoldButton
              title={showForm ? "Cancel" : "Add locker"}
              variant="outline"
              onPress={() => setShowForm((v) => !v)}
            />
          </View>
          <View style={{ flex: 1 }}>
            <GoldButton title="Scan Label" onPress={() => setScannerOpen(true)} />
          </View>
        </View>
        {scanError ? (
          <ThemedText variant="small" color={colors.red} style={{ marginTop: 8 }}>
            {scanError}
          </ThemedText>
        ) : null}
      </View>
      <QrScanner visible={scannerOpen} onClose={() => setScannerOpen(false)} onScanned={onScanned} title="Scan Packet Label" />
      {showForm ? (
        <Card style={{ marginHorizontal: 16, marginTop: 12 }}>
          <GoldTextInput label="Code" value={code} onChangeText={setCode} />
          <GoldTextInput label="Capacity" keyboardType="numeric" value={capacity} onChangeText={setCapacity} />
          {error ? (
            <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
              {error}
            </ThemedText>
          ) : null}
          <GoldButton
            title="Save"
            onPress={() => create.mutate()}
            loading={create.isPending}
            disabled={!code || !capacity}
          />
        </Card>
      ) : null}
      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16 }}>
        <ExpandableTable<Locker>
          columns={LOCKER_COLUMNS}
          visibleCount={LOCKER_COLUMNS.length}
          data={lockers}
          keyExtractor={(l) => String(l.id)}
          onViewDescription={(l) => router.push(`/packets?lockerId=${l.id}`)}
          emptyText={isLoading ? "Loading…" : isError ? "Could not load lockers." : "No lockers found."}
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
