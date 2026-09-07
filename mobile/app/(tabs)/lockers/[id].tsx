import React, { useState } from "react";
import { ScrollView, RefreshControl, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldButton } from "../../../src/components/GoldButton";
import { colors } from "../../../src/theme/colors";
import { getLocker, deleteLocker } from "../../../src/api/lockers";
import { ApiError } from "../../../src/api/client";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";

export default function LockerDetailScreen() {
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

  useRefetchOnFocus(refetch);

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
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      >
        {isLoading ? (
          <ThemedText color={colors.muted}>Loading…</ThemedText>
        ) : isError || !data ? (
          <ThemedText color={colors.red}>Could not load this locker.</ThemedText>
        ) : (
          <Card>
            <ThemedText variant="h2" color={colors.brandDeep}>
              {data.code}
            </ThemedText>
            <ThemedText variant="body" style={{ marginTop: 8 }}>
              Capacity {data.capacity}
              {data.occupied !== undefined ? ` · Occupied ${data.occupied}` : ""}
            </ThemedText>
            <ThemedText variant="small" color={colors.muted} style={{ marginTop: 4 }}>
              {data.isActive ? "Active" : "Inactive"}
            </ThemedText>
            {error ? (
              <ThemedText variant="small" color={colors.red} style={{ marginTop: 8 }}>
                {error}
              </ThemedText>
            ) : null}
            <GoldButton
              title="View packets in this locker"
              variant="outline"
              onPress={() => router.push(`/packets?lockerId=${lockerId}`)}
              style={{ marginTop: 12 }}
            />
            <GoldButton
              title="Delete locker"
              variant="outline"
              onPress={() => remove.mutate()}
              loading={remove.isPending}
              style={{ marginTop: 12 }}
            />
          </Card>
        )}
      </ScrollView>
      </View>
    </ScreenContainer>  );
}
