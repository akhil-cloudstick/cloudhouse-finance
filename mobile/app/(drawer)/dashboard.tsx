import React from "react";
import { ScrollView, View, StyleSheet, Pressable } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { ScreenContainer } from "../../src/components/ScreenContainer";
import { Card } from "../../src/components/Card";
import { ThemedText } from "../../src/components/ThemedText";
import { colors } from "../../src/theme/colors";
import { useAuth } from "../../src/auth/AuthContext";
import { latestGoldRate } from "../../src/api/goldRates";
import { getCalendarEvents } from "../../src/api/reminders";

// Every module now has its own sidebar entry (app/(drawer)/_layout.tsx) —
// this screen only shows KPIs, not a link grid.
export default function DashboardScreen() {
  const { employee, signOut } = useAuth();

  const goldRate = useQuery({ queryKey: ["gold-rates", "latest"], queryFn: latestGoldRate });
  const events = useQuery({ queryKey: ["reminders", "calendar"], queryFn: () => getCalendarEvents() });

  const overdueCount = events.data?.filter((e) => e.type === "Overdue").length ?? 0;
  const dueTodayCount =
    events.data?.filter((e) => e.type === "LoanDue" && e.date === new Date().toISOString().slice(0, 10))
      .length ?? 0;

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ThemedText variant="h2" color={colors.goldDeep}>
          Welcome, {employee?.name}
        </ThemedText>
        <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 16 }}>
          {employee?.role} · {employee?.branch?.name ?? `Branch #${employee?.branchId}`}
        </ThemedText>

        <View style={styles.kpiRow}>
          <Card style={styles.kpi}>
            <ThemedText variant="label" color={colors.muted}>
              24K Gold Rate
            </ThemedText>
            <ThemedText variant="h3" color={colors.goldDeep}>
              {goldRate.isLoading ? "…" : goldRate.data ? `₹${goldRate.data.k24.toLocaleString("en-IN")}` : "—"}
            </ThemedText>
          </Card>
          <Card style={styles.kpi}>
            <ThemedText variant="label" color={colors.muted}>
              Overdue
            </ThemedText>
            <ThemedText variant="h3" color={colors.red}>
              {events.isLoading ? "…" : overdueCount}
            </ThemedText>
          </Card>
          <Card style={styles.kpi}>
            <ThemedText variant="label" color={colors.muted}>
              Due Today
            </ThemedText>
            <ThemedText variant="h3" color={colors.amber}>
              {events.isLoading ? "…" : dueTodayCount}
            </ThemedText>
          </Card>
        </View>

        <Pressable onPress={signOut} style={{ marginTop: 24, marginBottom: 12 }}>
          <ThemedText variant="label" color={colors.red}>
            Log out
          </ThemedText>
        </Pressable>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  kpiRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  kpi: { flex: 1, alignItems: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: {
    minWidth: "47%",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 12,
  },
});
