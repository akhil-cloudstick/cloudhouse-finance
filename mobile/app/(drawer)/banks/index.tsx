import React, { useState } from "react";
import { FlatList, RefreshControl } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { colors } from "../../../src/theme/colors";
import { listBanks, createBank } from "../../../src/api/banks";
import { Bank } from "../../../src/types/bank";
import { useDebouncedValue } from "../../../src/hooks/useDebouncedValue";
import { ApiError } from "../../../src/api/client";

// Re-pledge/bank actions per loan happen from the loan's own detail screen
// (app/(drawer)/loans/[id].tsx) — this screen manages the bank directory
// itself (find-or-create by name), matching backend/internal/bank's shape.
export default function BanksScreen() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [name, setName] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["banks", debouncedSearch],
    queryFn: () => listBanks(debouncedSearch || undefined),
  });

  const create = useMutation({
    mutationFn: () => createBank({ name, ifsc: ifsc || undefined, accountNo: accountNo || undefined }),
    onSuccess: () => {
      setName("");
      setIfsc("");
      setAccountNo("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["banks"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <Card style={{ marginHorizontal: 16 }}>
        <ThemedText variant="h3" style={{ marginBottom: 8 }}>
          Add bank
        </ThemedText>
        <GoldTextInput label="Name" value={name} onChangeText={setName} />
        <GoldTextInput label="IFSC" value={ifsc} onChangeText={setIfsc} />
        <GoldTextInput label="Account no." value={accountNo} onChangeText={setAccountNo} />
        {error ? (
          <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
            {error}
          </ThemedText>
        ) : null}
        <GoldButton title="Save" onPress={() => create.mutate()} loading={create.isPending} disabled={!name} />
      </Card>

      <GoldTextInput
        label="Search banks"
        value={search}
        onChangeText={setSearch}
        style={{ marginHorizontal: 16 }}
      />

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
        renderItem={({ item }) => (
          <Card>
            <ThemedText variant="h3">{item.name}</ThemedText>
            <ThemedText variant="small" color={colors.muted}>
              {item.ifsc ?? "No IFSC"} · {item.accountNo ?? "No account no."}
            </ThemedText>
          </Card>
        )}
      />
    </ScreenContainer>
  );
}
