import React, { useState } from "react";
import { RefreshControl, View, ScrollView, Pressable } from "react-native";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { BottomSheetModal } from "../../../src/components/BottomSheetModal";
import { colors } from "../../../src/theme/colors";
import { listBanksPage, createBank } from "../../../src/api/banks";
import { Bank } from "../../../src/types/bank";
import { useDebouncedValue } from "../../../src/hooks/useDebouncedValue";
import { ApiError } from "../../../src/api/client";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";
import { ExpandableTable, type TableColumn } from "../../../src/components/ExpandableTable";

const PAGE_SIZE = 10;

// Banks created with only a name come back with "" (not null) for the
// optional fields — render "—" instead of a blank cell.
const or = (v?: string) => (v && v.trim() ? v : "—");

const BANK_COLUMNS: TableColumn<Bank>[] = [
  { key: "name", label: "Name", render: (b) => (b.name ? b.name : "(unnamed)"), weight: 1.3 },
  { key: "ifsc", label: "IFSC", render: (b) => or(b.ifsc) },
  { key: "phone", label: "Phone", render: (b) => or(b.phone) },
];
function bankExtraFields(b: Bank) {
  return [{ label: "Account No.", value: or(b.accountNo) }];
}

// Re-pledge/bank actions per loan happen from the loan's own detail screen
// (app/(tabs)/loans/[id].tsx) — this screen manages the bank directory
// itself (find-or-create by name), matching backend/internal/bank's shape.
export default function BanksScreen() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [addVisible, setAddVisible] = useState(false);
  const [name, setName] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError, isFetching, isFetchingNextPage, fetchNextPage, hasNextPage, refetch } = useInfiniteQuery({
    queryKey: ["banks", debouncedSearch],
    queryFn: ({ pageParam = 0 }) => listBanksPage({ q: debouncedSearch || undefined, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
  });

  useRefetchOnFocus(refetch);

  const banks = data?.pages.flatMap((p) => p.items) ?? [];

  function reset() {
    setName("");
    setIfsc("");
    setAccountNo("");
    setPhone("");
    setError(null);
  }

  const create = useMutation({
    mutationFn: () =>
      createBank({
        name,
        ifsc: ifsc || undefined,
        accountNo: accountNo || undefined,
        phone: phone || undefined,
      }),
    onSuccess: () => {
      reset();
      setAddVisible(false);
      queryClient.invalidateQueries({ queryKey: ["banks"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 20, flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <GoldTextInput label="Search banks" value={search} onChangeText={setSearch} />
        </View>
      </View>
      <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
        <GoldButton title="+ Add bank" variant="outline" onPress={() => setAddVisible(true)} />
      </View>

      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        <ExpandableTable<Bank>
          columns={BANK_COLUMNS}
          visibleCount={BANK_COLUMNS.length}
          data={banks}
          keyExtractor={(b) => String(b.id)}
          extraFields={bankExtraFields}
          emptyText={isLoading ? "Loading…" : isError ? "Could not load banks." : "No banks found."}
          refreshControl={<RefreshControl refreshing={isFetching && !isFetchingNextPage && !isLoading} onRefresh={refetch} />}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          isFetchingNextPage={isFetchingNextPage}
        />
      </View>

      <BottomSheetModal visible={addVisible} onClose={() => { reset(); setAddVisible(false); }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <ThemedText variant="h3" color={colors.goldDeep}>
            Add Bank
          </ThemedText>
          <Pressable onPress={() => { reset(); setAddVisible(false); }} hitSlop={10}>
            <ThemedText variant="h3" color={colors.muted}>
              ×
            </ThemedText>
          </Pressable>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <GoldTextInput label="Name" value={name} onChangeText={setName} />
          <GoldTextInput label="IFSC" value={ifsc} onChangeText={setIfsc} />
          <GoldTextInput label="Account no." value={accountNo} onChangeText={setAccountNo} />
          <GoldTextInput label="Phone" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
          {error ? (
            <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
              {error}
            </ThemedText>
          ) : null}
          <GoldButton title="Save" onPress={() => create.mutate()} loading={create.isPending} disabled={!name} />
        </ScrollView>
      </BottomSheetModal>
    </ScreenContainer>
  );
}
