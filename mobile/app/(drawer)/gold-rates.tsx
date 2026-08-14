import React from "react";
import { FlatList, RefreshControl } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { ScreenContainer } from "../../src/components/ScreenContainer";
import { Card } from "../../src/components/Card";
import { ThemedText } from "../../src/components/ThemedText";
import { colors } from "../../src/theme/colors";
import { listGoldRates } from "../../src/api/goldRates";
import { GoldRate } from "../../src/types/goldRate";

// Read-only list — the backend already returns rates newest-first (each
// publish is append-only, see backend/internal/goldrate/model.go); no
// client-side sort/filter is applied here per the plan's server-side rule.
export default function GoldRatesScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["gold-rates"],
    queryFn: listGoldRates,
  });

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <FlatList<GoldRate>
        data={data ?? []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={
          <ThemedText color={colors.muted}>
            {isLoading ? "Loading…" : isError ? "Could not load gold rates." : "No rates published yet."}
          </ThemedText>
        }
        renderItem={({ item }) => (
          <Card>
            <ThemedText variant="h3" color={colors.goldDeep}>
              ₹{item.k24.toLocaleString("en-IN")} / g (24K)
            </ThemedText>
            <ThemedText variant="small" color={colors.muted}>
              {new Date(item.date).toDateString()} · set by {item.setBy}
            </ThemedText>
          </Card>
        )}
      />
    </ScreenContainer>
  );
}
