import React, { useState } from "react";
import { Pressable, RefreshControl, View } from "react-native";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { ChipSelect } from "../../../src/components/ChipSelect";
import { Icon } from "../../../src/components/Icon";
import { BottomSheetModal, SheetScrollView } from "../../../src/components/BottomSheetModal";
import { colors, statusColors } from "../../../src/theme/colors";
import { listLockersPage, createLocker, updateLocker } from "../../../src/api/lockers";
import { listBranches } from "../../../src/api/branches";
import { getPacketByCode } from "../../../src/api/packets";
import { Locker } from "../../../src/types/locker";
import { useAuth } from "../../../src/auth/AuthContext";
import { ApiError } from "../../../src/api/client";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";
import { useDebouncedValue } from "../../../src/hooks/useDebouncedValue";
import { QrScanner, parsePacketCode } from "../../../src/components/QrScanner";
import { ExpandableTable, type TableColumn } from "../../../src/components/ExpandableTable";

const PAGE_SIZE = 10;
const ACTIVE_OPTIONS = ["Active", "Inactive"] as const;

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
  { key: "occupied", label: "Occupied", render: (l) => `${l.occupied ?? 0}/${l.capacity}` },
  { key: "status", label: "Status", render: (l) => <StatusPill active={l.isActive} /> },
];

function lockerExtraFields(l: Locker) {
  return [
    { label: "Branch", value: l.branch?.name ?? "—" },
    { label: "Capacity", value: String(l.capacity) },
  ];
}

export default function LockersScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { employee, can } = useAuth();
  const canCreate = can("Locker_Management", "can_create_locker");
  const canUpdate = can("Locker_Management", "can_update_locker");

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const q = debouncedSearch.trim() || undefined;
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Sheet state: `editing` null + visible = create, otherwise edit.
  const [sheetVisible, setSheetVisible] = useState(false);
  const [editing, setEditing] = useState<Locker | null>(null);
  const [code, setCode] = useState("");
  const [capacity, setCapacity] = useState("");
  const [branchId, setBranchId] = useState<number | undefined>(undefined);
  const [active, setActive] = useState<(typeof ACTIVE_OPTIONS)[number]>("Active");
  const [error, setError] = useState<string | null>(null);

  // ["lockers", "page", …] — kept distinct from the packet screen's
  // ["lockers", "picker", …] so the two cache shapes never collide.
  const { data, isLoading, isError, isFetching, isFetchingNextPage, fetchNextPage, hasNextPage, refetch } = useInfiniteQuery({
    queryKey: ["lockers", "page", q],
    queryFn: ({ pageParam = 0 }) => listLockersPage({ q, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
  });

  useRefetchOnFocus(refetch);

  const lockers = data?.pages.flatMap((p) => p.items) ?? [];

  const branches = useQuery({ queryKey: ["branches"], queryFn: listBranches, enabled: sheetVisible });
  const branchOptions = (branches.data ?? []).filter((b) => b.isActive || b.id === branchId);

  function openCreate() {
    setEditing(null);
    setCode("");
    setCapacity("");
    setBranchId(employee?.branchId);
    setActive("Active");
    setError(null);
    setSheetVisible(true);
  }

  function openEdit(l: Locker) {
    setEditing(l);
    setCode(l.code);
    setCapacity(String(l.capacity));
    setBranchId(l.branchId);
    setActive(l.isActive ? "Active" : "Inactive");
    setError(null);
    setSheetVisible(true);
  }

  function closeSheet() {
    setSheetVisible(false);
    setError(null);
  }

  const save = useMutation({
    mutationFn: () => {
      const input = { code: code.trim().toUpperCase(), branchId: branchId!, capacity: Number(capacity) };
      return editing
        ? updateLocker(editing.id, { ...input, isActive: active === "Active" })
        : createLocker(input);
    },
    onSuccess: () => {
      closeSheet();
      queryClient.invalidateQueries({ queryKey: ["lockers"] });
      queryClient.invalidateQueries({ queryKey: ["locker"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  const capacityNum = Number(capacity);
  const capacityValid = Number.isInteger(capacityNum) && capacityNum > 0;
  // Shrinking below what's already stored would strand packets.
  const belowOccupied = !!editing && capacityValid && capacityNum < (editing.occupied ?? 0);
  const canSave = !!code.trim() && capacityValid && !belowOccupied && branchId != null;

  // Scanning a packet's label is a shortcut to its detail screen, where the
  // check-in-to-locker move happens.
  async function onScanned(scanned: string) {
    setScannerOpen(false);
    const packetCode = parsePacketCode(scanned);
    if (!packetCode) {
      setScanError("That QR code isn't a packet label.");
      return;
    }
    setScanError(null);
    try {
      const packet = await getPacketByCode(packetCode);
      router.push(`/packets/${packet.id}`);
    } catch {
      setScanError("No packet found for that code.");
    }
  }

  // Scrolls away with the rows (ExpandableTable's headerContent) so the
  // table's top fade sits right under the app header.
  const listHeader = (
      <View style={{ paddingTop: 20 }}>
        <GoldTextInput
          label="Search lockers"
          value={search}
          onChangeText={setSearch}
          right={
            <Pressable onPress={() => setScannerOpen(true)} hitSlop={12} accessibilityLabel="Scan packet label">
              <Icon name="scan" size={18} color={colors.brandDeep} />
            </Pressable>
          }
        />
        {scanError ? (
          <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
            {scanError}
          </ThemedText>
        ) : null}
        {canCreate ? (
          <View style={{ marginBottom: 8 }}>
            <GoldButton title="Add Locker" icon="plus" variant="outline" onPress={openCreate} />
          </View>
        ) : null}
      </View>
  );

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <QrScanner visible={scannerOpen} onClose={() => setScannerOpen(false)} onScanned={onScanned} title="Scan Packet Label" />
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        <ExpandableTable<Locker>
          headerContent={listHeader}
          columns={LOCKER_COLUMNS}
          visibleCount={LOCKER_COLUMNS.length}
          data={lockers}
          keyExtractor={(l) => String(l.id)}
          extraFields={(l) => [
            ...lockerExtraFields(l),
            ...(canUpdate
              ? [{ label: "", value: <GoldButton title="Edit locker" variant="outline" onPress={() => openEdit(l)} style={{ height: 38 }} /> }]
              : []),
          ]}
          // Opens the locker page, which lists its stored packets (each links to the packet).
          onViewDescription={(l) => router.push(`/lockers/${l.id}`)}
          emptyText={isLoading ? "Loading…" : isError ? "Could not load lockers." : "No lockers found."}
          refreshControl={<RefreshControl refreshing={isFetching && !isFetchingNextPage && !isLoading} onRefresh={refetch} />}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          isFetchingNextPage={isFetchingNextPage}
        />
      </View>

      <BottomSheetModal visible={sheetVisible} onClose={closeSheet}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <ThemedText variant="h3" color={colors.brandDeep}>
            {editing ? `Edit Locker ${editing.code}` : "Add Locker"}
          </ThemedText>
          <Pressable onPress={closeSheet} hitSlop={10}>
            <ThemedText variant="h3" color={colors.muted}>
              ×
            </ThemedText>
          </Pressable>
        </View>
        <SheetScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <GoldTextInput
            label="Code"
            value={code}
            onChangeText={(v) => setCode(v.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <GoldTextInput
            label={editing ? `Capacity (holds ${editing.occupied ?? 0} now)` : "Capacity"}
            keyboardType="number-pad"
            value={capacity}
            onChangeText={(v) => setCapacity(v.replace(/[^0-9]/g, ""))}
          />
          {belowOccupied ? (
            <ThemedText variant="small" color={colors.red} style={{ marginTop: -6, marginBottom: 10 }}>
              Capacity can't be lower than the {editing!.occupied} packets already stored.
            </ThemedText>
          ) : null}
          {branchOptions.length ? (
            <ChipSelect
              label="Branch"
              options={branchOptions.map((b) => b.name)}
              value={branchOptions.find((b) => b.id === branchId)?.name}
              onChange={(name) => setBranchId(branchOptions.find((b) => b.name === name)?.id)}
            />
          ) : (
            <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 14 }}>
              {branches.isLoading
                ? "Loading branches…"
                : `Branch: ${editing?.branch?.name ?? (branchId === employee?.branchId ? "your branch" : `#${branchId ?? "—"}`)}`}
            </ThemedText>
          )}
          {editing ? (
            <ChipSelect label="Status" options={ACTIVE_OPTIONS} value={active} onChange={setActive} />
          ) : null}
          {error ? (
            <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
              {error}
            </ThemedText>
          ) : null}
          <GoldButton
            title={editing ? "Save changes" : "Create locker"}
            onPress={() => save.mutate()}
            loading={save.isPending}
            disabled={!canSave}
          />
          {editing ? (
            <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
              <View style={{ flex: 1 }}>
                <GoldButton
                  title="View packets"
                  icon="box"
                  variant="outline"
                  onPress={() => {
                    const id = editing.id;
                    closeSheet();
                    router.push(`/packets?lockerId=${id}`);
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <GoldButton
                  title="Details"
                  variant="outline"
                  onPress={() => {
                    const id = editing.id;
                    closeSheet();
                    router.push(`/lockers/${id}`);
                  }}
                />
              </View>
            </View>
          ) : null}
        </SheetScrollView>
      </BottomSheetModal>
    </ScreenContainer>
  );
}
