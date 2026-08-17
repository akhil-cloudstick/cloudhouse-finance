import React, { useState } from "react";
import { FlatList, RefreshControl, View, ScrollView } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { BottomSheetModal } from "../../../src/components/BottomSheetModal";
import { colors } from "../../../src/theme/colors";
import { listBanks, createBank } from "../../../src/api/banks";
import { Bank } from "../../../src/types/bank";
import { useDebouncedValue } from "../../../src/hooks/useDebouncedValue";
import { ApiError } from "../../../src/api/client";

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

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["banks", debouncedSearch],
    queryFn: () => listBanks(debouncedSearch || undefined),
  });

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
      <View style={{ paddingHorizontal: 16, flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <GoldTextInput label="Search banks" value={search} onChangeText={setSearch} />
        </View>
      </View>
      <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
        <GoldButton title="+ Add bank" variant="outline" onPress={() => setAddVisible(true)} />
      </View>

      <FlatList<Bank>
        data={data ?? []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={
          <ThemedText color={colors.muted}>
            {isLoading ? "Loading…" : isError ? "Could not load banks." : "No banks found."}
          </ThemedText>
        }
        renderItem={({ item }) => {
          // Banks created with only a name come back with "" (not null) for
          // the optional fields, so `?? fallback` never fired and the row
          // rendered a bare " ·  · ". Join only the parts that actually have
          // a value, and say so plainly when none do.
          const details = [item.ifsc, item.accountNo, item.phone].filter((v) => v?.trim());
          return (
            <Card>
              {/* Falls back to a visible label instead of rendering a blank
                  card — a bank row with an empty/null name otherwise showed
                  as an empty white box in the list. "body" (not "h3") avoids
                  clipping long names, same fix as customers/loans lists. */}
              <ThemedText variant="body" color={item.name ? colors.ink : colors.muted}>
                {item.name || "(unnamed bank)"}
              </ThemedText>
              <ThemedText variant="small" color={colors.muted}>
                {details.length ? details.join(" · ") : "No IFSC, account no. or phone yet"}
              </ThemedText>
            </Card>
          );
        }}
      />

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
