import React, { useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { ScreenContainer } from "../../src/components/ScreenContainer";
import { Card } from "../../src/components/Card";
import { ThemedText } from "../../src/components/ThemedText";
import { GoldTextInput } from "../../src/components/GoldTextInput";
import { GoldButton } from "../../src/components/GoldButton";
import { colors } from "../../src/theme/colors";
import { listPurityStandards, createPurityStandard } from "../../src/api/purityStandards";
import { PurityStandard } from "../../src/types/purityStandard";
import { useDebouncedValue } from "../../src/hooks/useDebouncedValue";
import { ApiError } from "../../src/api/client";
import { useRefetchOnFocus } from "../../src/hooks/useRefetchOnFocus";

export default function PurityStandardsScreen() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [karat, setKarat] = useState("");
  const [fineness, setFineness] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["purity-standards", debouncedSearch],
    queryFn: () => listPurityStandards(debouncedSearch || undefined),
  });

  useRefetchOnFocus(refetch);

  const create = useMutation({
    mutationFn: () =>
      createPurityStandard({
        karat: karat ? Number(karat) : undefined,
        finenessPercent: fineness ? Number(fineness) : undefined,
        label,
      }),
    onSuccess: () => {
      setKarat("");
      setFineness("");
      setLabel("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["purity-standards"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <Card style={{ marginHorizontal: 16 }}>
        <ThemedText variant="h3" style={{ marginBottom: 8 }}>
          Add purity standard
        </ThemedText>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <GoldTextInput label="Karat" keyboardType="numeric" value={karat} onChangeText={setKarat} />
          </View>
          <View style={{ flex: 1 }}>
            <GoldTextInput
              label="Fineness %"
              keyboardType="numeric"
              value={fineness}
              onChangeText={setFineness}
            />
          </View>
        </View>
        <GoldTextInput label="Label" value={label} onChangeText={setLabel} />
        {error ? (
          <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
            {error}
          </ThemedText>
        ) : null}
        <GoldButton
          title="Add"
          onPress={() => create.mutate()}
          loading={create.isPending}
          disabled={!label || (!karat && !fineness)}
        />
      </Card>

      <GoldTextInput
        label="Search"
        placeholder="Karat, fineness, or label…"
        value={search}
        onChangeText={setSearch}
        containerStyle={{ marginHorizontal: 16 }}
      />

      <FlatList<PurityStandard>
        data={data ?? []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={
          <ThemedText color={colors.muted}>
            {isLoading ? "Loading…" : isError ? "Could not load purity standards." : "None yet."}
          </ThemedText>
        }
        renderItem={({ item }) => (
          <Card>
            <ThemedText variant="h3">{item.label}</ThemedText>
            <ThemedText variant="small" color={colors.muted}>
              {item.karat ? `${item.karat}K` : ""}
              {item.karat && item.finenessPercent ? " · " : ""}
              {item.finenessPercent ? `${item.finenessPercent}%` : ""}
              {!item.isActive ? " · inactive" : ""}
            </ThemedText>
          </Card>
        )}
      />
    </ScreenContainer>
  );
}
