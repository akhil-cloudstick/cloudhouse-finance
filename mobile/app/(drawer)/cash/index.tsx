import React from "react";
import { View, ScrollView } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldButton } from "../../../src/components/GoldButton";
import { colors } from "../../../src/theme/colors";
import { getCashSummary } from "../../../src/api/cash";
import { useAuth } from "../../../src/auth/AuthContext";

import { fmt } from "../../../src/lib/format";

export default function CashSummaryScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const today = new Date().toISOString().slice(0, 10);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["cash-summary", employee?.branchId, today],
    queryFn: () => getCashSummary(employee!.branchId, today),
    enabled: !!employee,
  });

  return (
    <ScreenContainer>
      {/* No ScrollView here previously — on a short screen the summary
          Card plus the two nav buttons below could clip, same overflow
          bug schemes/new.tsx had. */}
      <ScrollView showsVerticalScrollIndicator={false}>
      <Card>
        <ThemedText variant="h3" style={{ marginBottom: 8 }}>
          Today's cash summary
        </ThemedText>
        {isLoading ? (
          <ThemedText color={colors.muted}>Loading…</ThemedText>
        ) : isError || !data ? (
          <ThemedText color={colors.red}>Could not load today's summary.</ThemedText>
        ) : (
          <>
            <ThemedText variant="body">Opening cash: {fmt(data.openingCash)}</ThemedText>
            <ThemedText variant="body" color={colors.green}>
              Cash in: {fmt(data.collections)}
            </ThemedText>
            <ThemedText variant="body">Cash out: {fmt(data.disbursements)}</ThemedText>
            <ThemedText variant="body">Expenses (cash): {fmt(data.cashExpenses)}</ThemedText>
            <ThemedText variant="h3" color={colors.goldDeep} style={{ marginTop: 8 }}>
              Expected cash in hand: {fmt(data.expectedCash)}
            </ThemedText>
          </>
        )}
      </Card>

      <View style={{ gap: 12 }}>
        <GoldButton title="Cash Movements" variant="outline" onPress={() => router.push("/cash/movements")} />
        <GoldButton title="Expenses" variant="outline" onPress={() => router.push("/cash/expenses")} />
      </View>
      </ScrollView>
    </ScreenContainer>
  );
}
