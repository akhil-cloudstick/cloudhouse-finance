import React, { useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { ScreenContainer } from "../../src/components/ScreenContainer";
import { Card } from "../../src/components/Card";
import { ThemedText } from "../../src/components/ThemedText";
import { GoldTextInput } from "../../src/components/GoldTextInput";
import { GoldButton } from "../../src/components/GoldButton";
import { colors } from "../../src/theme/colors";
import { listOrnamentTypes, createOrnamentType } from "../../src/api/ornamentTypes";
import { OrnamentType } from "../../src/types/ornamentType";
import { useDebouncedValue } from "../../src/hooks/useDebouncedValue";
import { ApiError } from "../../src/api/client";

export default function OrnamentTypesScreen() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["ornament-types", debouncedSearch],
    queryFn: () => listOrnamentTypes(debouncedSearch || undefined),
  });

  const create = useMutation({
    mutationFn: () => createOrnamentType(name),
    onSuccess: () => {
      setName("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["ornament-types"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <Card style={{ marginHorizontal: 16 }}>
        <ThemedText variant="h3" style={{ marginBottom: 8 }}>
          Add ornament type
        </ThemedText>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}>
            <GoldTextInput placeholder="e.g. Necklace" value={name} onChangeText={setName} />
          </View>
        </View>
        {error ? (
          <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
            {error}
          </ThemedText>
        ) : null}
        <GoldButton title="Add" onPress={() => create.mutate()} loading={create.isPending} disabled={!name} />
      </Card>

      <GoldTextInput
        label="Search"
        placeholder="Ornament type name…"
        value={search}
        onChangeText={setSearch}
        containerStyle={{ marginHorizontal: 16 }}
      />

      <FlatList<OrnamentType>
        data={data ?? []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={
          <ThemedText color={colors.muted}>
            {isLoading ? "Loading…" : isError ? "Could not load ornament types." : "None yet."}
          </ThemedText>
        }
        renderItem={({ item }) => (
          <Card>
            <ThemedText variant="h3">{item.name}</ThemedText>
          </Card>
        )}
      />
    </ScreenContainer>
  );
}
