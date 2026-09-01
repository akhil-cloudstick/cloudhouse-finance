import React, { useEffect, useState } from "react";
import { RefreshControl, View, ScrollView } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { Pager } from "../../../src/components/Pager";
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
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["banks", debouncedSearch, page],
    queryFn: () => listBanksPage({ q: debouncedSearch || undefined, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  });

  useRefetchOnFocus(refetch);

  const banks = data?.items ?? [];

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
      setPage(1);
      queryClient.invalidateQueries({ queryKey: ["banks"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: 16, flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <GoldTextInput label="Search banks" value={search} onChangeText={setSearch} />
        </View>
      </View>
      <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
        <GoldButton title="+ Add bank" variant="outline" onPress={() => setAddVisible(true)} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} />}
      >
        <ExpandableTable<Bank>
          columns={BANK_COLUMNS}
          visibleCount={BANK_COLUMNS.length}
          data={banks}
          keyExtractor={(b) => String(b.id)}
          extraFields={bankExtraFields}
          emptyText={isLoading ? "Loading…" : isError ? "Could not load banks." : "No banks found."}
        />
        <Pager page={page} hasMore={!!data?.hasMore} onChange={setPage} loading={isFetching} />
      </ScrollView>

      <BottomSheetModal visible={addVisible} onClose={() => { reset(); setAddVisible(false); }}>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <ThemedText variant="h3" style={{ marginBottom: 8 }}>
            Add bank
          </ThemedText>
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
