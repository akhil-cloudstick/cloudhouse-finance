import React, { useState } from "react";
import { RefreshControl, View, Pressable, StyleSheet } from "react-native";
import { Icon } from "../../../src/components/Icon";
import { listPackets } from "../../../src/api/packets";
import { GutterScrollView } from "../../../src/components/Gutter";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldButton } from "../../../src/components/GoldButton";
import { colors } from "../../../src/theme/colors";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { getLocker, deleteLocker } from "../../../src/api/lockers";
import { ApiError } from "../../../src/api/client";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";
import { Loading } from "../../../src/components/Loading";

export default function LockerDetailScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const lockerId = Number(id);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["locker", id],
    queryFn: () => getLocker(lockerId),
    enabled: !!id,
  });

  const packets = useQuery({
    queryKey: ["packets", "inLocker", lockerId],
    queryFn: () => listPackets({ lockerId }),
    enabled: !!id,
  });

  useRefetchOnFocus(refetch, packets.refetch);

  const remove = useMutation({
    mutationFn: () => deleteLocker(lockerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lockers"] });
      router.back();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not delete."),
  });

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <View style={{ flex: 1, paddingHorizontal: 8, paddingTop: 20 }}>
      <GutterScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      >
        {isLoading ? (
          <Loading full />
        ) : isError || !data ? (
          <ThemedText color={colors.red}>Could not load this locker.</ThemedText>
        ) : (
          <Card>
            <ThemedText variant="h2" color={colors.brandDeep}>
              {data.code}
            </ThemedText>
            <ThemedText variant="body" style={{ marginTop: 8 }}>
              Occupied {data.occupied ?? 0}/{data.capacity}
            </ThemedText>
            <ThemedText variant="small" color={colors.muted} style={{ marginTop: 4 }}>
              {data.branch?.name ? `${data.branch.name} · ` : ""}
              {data.isActive ? "Active" : "Inactive"}
            </ThemedText>
            {error ? (
              <ThemedText variant="small" color={colors.red} style={{ marginTop: 8 }}>
                {error}
              </ThemedText>
            ) : null}
            <GoldButton
              title="Delete locker"
              variant="outline"
              onPress={() => remove.mutate()}
              loading={remove.isPending}
              style={{ marginTop: 12 }}
            />
          </Card>
        )}

        {data ? (
          <Card>
            <ThemedText variant="h3" style={{ marginBottom: 8 }}>
              Stored Packets
            </ThemedText>
            {packets.isLoading ? (
              <Loading />
            ) : (packets.data ?? []).length === 0 ? (
              <ThemedText color={colors.muted}>No packets are stored in this locker.</ThemedText>
            ) : (
              (packets.data ?? []).map((p, i) => (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    // List first so the back chevron lands on Packets, not here.
                    router.push("/packets");
                    router.push(`/packets/${p.id}`);
                  }}
                  style={[styles.packetRow, i > 0 && styles.packetDivider]}
                >
                  <View style={{ flex: 1 }}>
                    <ThemedText variant="body" color={colors.brandDeep} style={{ fontWeight: "600" }}>
                      {p.code}
                    </ThemedText>
                    <ThemedText variant="small" color={colors.muted}>
                      {p.loan?.loanNumber ?? `Loan #${p.loanId}`}
                      {p.loan?.customer?.name ? ` · ${p.loan.customer.name}` : ""}
                      {p.totalNetWeight ? ` · ${p.totalNetWeight.toFixed(2)}g` : ""}
                    </ThemedText>
                  </View>
                  <View style={{ transform: [{ rotate: "180deg" }] }}>
                    <Icon name="chevronLeft" size={14} color={colors.muted} />
                  </View>
                </Pressable>
              ))
            )}
          </Card>
        ) : null}
      </GutterScrollView>
      </View>
    </ScreenContainer>  );
}

const styles = StyleSheet.create({
  packetRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  packetDivider: { borderTopWidth: 1, borderTopColor: colors.line },
});
