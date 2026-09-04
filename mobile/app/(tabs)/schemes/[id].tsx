import React, { useState } from "react";
import { ScrollView, RefreshControl, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { colors } from "../../../src/theme/colors";
import { getScheme, toggleSchemeActive, calculateSchemeEligibility } from "../../../src/api/schemes";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";

export default function SchemeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const schemeId = Number(id);
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["scheme", id],
    queryFn: () => getScheme(schemeId),
    enabled: !!id,
  });

  useRefetchOnFocus(refetch);

  const toggle = useMutation({
    mutationFn: () => toggleSchemeActive(schemeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheme", id] });
      queryClient.invalidateQueries({ queryKey: ["schemes"] });
    },
  });

  const [goldWeight, setGoldWeight] = useState("");
  const [goldRate, setGoldRate] = useState("");
  const [eligible, setEligible] = useState<number | null>(null);
  const calculate = useMutation({
    mutationFn: () => calculateSchemeEligibility(schemeId, Number(goldWeight), Number(goldRate)),
    onSuccess: (res) => setEligible(res.eligibleAmount),
  });

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <View style={{ flex: 1, paddingHorizontal: 8, paddingTop: 20 }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      >
        {isLoading ? (
          <ThemedText color={colors.muted}>Loading…</ThemedText>
        ) : isError || !data ? (
          <ThemedText color={colors.red}>Could not load this scheme.</ThemedText>
        ) : (
          <>
            <Card>
              <ThemedText variant="h2" color={colors.goldDeep}>
                {data.name}
              </ThemedText>
              <ThemedText variant="small" color={colors.muted} style={{ marginTop: 4 }}>
                {data.code}
              </ThemedText>
              <ThemedText variant="body" style={{ marginTop: 12 }}>
                Interest {data.interestRate}% · {data.durationMonths} months · LTV {data.ltvPercent}%
              </ThemedText>
              {data.conditions ? (
                <ThemedText variant="small" color={colors.muted} style={{ marginTop: 8 }}>
                  {data.conditions}
                </ThemedText>
              ) : null}
              <GoldButton
                title={data.isActive ? "Deactivate" : "Activate"}
                variant="outline"
                onPress={() => toggle.mutate()}
                loading={toggle.isPending}
              />
            </Card>

            <Card>
              <ThemedText variant="h3" style={{ marginBottom: 8 }}>
                Eligibility calculator
              </ThemedText>
              <GoldTextInput
                label="Gold weight (g)"
                keyboardType="numeric"
                value={goldWeight}
                onChangeText={setGoldWeight}
              />
              <GoldTextInput
                label="Gold rate (₹/g)"
                keyboardType="numeric"
                value={goldRate}
                onChangeText={setGoldRate}
              />
              <GoldButton
                title="Calculate"
                onPress={() => calculate.mutate()}
                loading={calculate.isPending}
                disabled={!goldWeight || !goldRate}
              />
              {eligible !== null ? (
                <ThemedText variant="h3" color={colors.goldDeep} style={{ marginTop: 8 }}>
                  Eligible: ₹{eligible.toLocaleString("en-IN")}
                </ThemedText>
              ) : null}
            </Card>
          </>
        )}
      </ScrollView>
      </View>
    </ScreenContainer>  );
}
