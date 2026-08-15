import React, { useState } from "react";
import { FlatList, RefreshControl, View, StyleSheet } from "react-native";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { ScreenContainer } from "../../src/components/ScreenContainer";
import { Card } from "../../src/components/Card";
import { ThemedText } from "../../src/components/ThemedText";
import { GoldTextInput } from "../../src/components/GoldTextInput";
import { GoldButton } from "../../src/components/GoldButton";
import { PurityStandardsModal } from "../../src/components/PurityStandardsModal";
import { colors } from "../../src/theme/colors";
import { listGoldRates, publishGoldRate } from "../../src/api/goldRates";
import { GoldRate } from "../../src/types/goldRate";
import { ApiError } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";

// Read-only list — the backend already returns rates newest-first (each
// publish is append-only, see backend/internal/goldrate/model.go); no
// client-side sort/filter is applied here per the plan's server-side rule.
// The form below mirrors frontend/components/Dashboard.tsx's RateModalContent
// (POST /gold-rates — only the 24K benchmark is entered, setBy is the signed-
// in employee's name, date defaults server-side to today when omitted).
export default function GoldRatesScreen() {
  const queryClient = useQueryClient();
  const { employee } = useAuth();
  const [formVisible, setFormVisible] = useState(false);
  const [purityVisible, setPurityVisible] = useState(false);
  const [k24, setK24] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["gold-rates"],
    queryFn: listGoldRates,
  });

  const publish = useMutation({
    mutationFn: () =>
      publishGoldRate({ k24: Number(k24), setBy: employee?.name ?? "Mobile App" }),
    onSuccess: () => {
      setK24("");
      setError(null);
      setFormVisible(false);
      queryClient.invalidateQueries({ queryKey: ["gold-rates"] });
      queryClient.invalidateQueries({ queryKey: ["gold-rates", "latest"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not publish rate."),
  });

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 8 }}>
        <View style={{ flex: 1 }}>
          <GoldButton
            title={formVisible ? "Cancel" : "+ Set today's rate"}
            variant={formVisible ? "outline" : "primary"}
            onPress={() => setFormVisible((v) => !v)}
          />
        </View>
        <View style={{ flex: 1 }}>
          <GoldButton title="Purity standards" variant="outline" onPress={() => setPurityVisible(true)} />
        </View>
      </View>

      {formVisible ? (
        <Card style={{ marginHorizontal: 16 }}>
          <ThemedText variant="h3" style={{ marginBottom: 8 }}>
            Set today&apos;s 24K rate
          </ThemedText>
          <GoldTextInput
            label="24K rate (₹ per gram)"
            keyboardType="numeric"
            value={k24}
            onChangeText={setK24}
          />
          {error ? (
            <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
              {error}
            </ThemedText>
          ) : null}
          <GoldButton
            title={publish.isPending ? "Publishing…" : "Publish"}
            onPress={() => publish.mutate()}
            loading={publish.isPending}
            disabled={!k24 || Number(k24) <= 0}
          />
        </Card>
      ) : null}

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

      <PurityStandardsModal visible={purityVisible} onClose={() => setPurityVisible(false)} />
    </ScreenContainer>
  );
}
