import React from "react";
import { ScrollView, RefreshControl } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldButton } from "../../../src/components/GoldButton";
import { colors } from "../../../src/theme/colors";
import { getBranch, deactivateBranch } from "../../../src/api/branches";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";

export default function BranchDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const branchId = Number(id);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["branch", id],
    queryFn: () => getBranch(branchId),
    enabled: !!id,
  });

  useRefetchOnFocus(refetch);

  const deactivate = useMutation({
    mutationFn: () => deactivateBranch(branchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branches"] });
      router.back();
    },
  });

  return (
    <ScreenContainer>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      >
        {isLoading ? (
          <ThemedText color={colors.muted}>Loading…</ThemedText>
        ) : isError || !data ? (
          <ThemedText color={colors.red}>Could not load this branch.</ThemedText>
        ) : (
          <Card>
            <ThemedText variant="h2" color={colors.goldDeep}>
              {data.name}
            </ThemedText>
            <ThemedText variant="body" style={{ marginTop: 8 }}>
              {data.code || "—"} · {data.address}
            </ThemedText>
            <ThemedText variant="small" color={colors.muted} style={{ marginTop: 4 }}>
              {data.phone || "No phone set"}
            </ThemedText>
            <ThemedText
              variant="small"
              color={data.isActive ? colors.muted : colors.red}
              style={{ marginTop: 8 }}
            >
              {data.isActive ? "Active" : "Inactive"}
            </ThemedText>
            {data.isActive ? (
              <GoldButton
                title="Deactivate branch"
                variant="outline"
                onPress={() => deactivate.mutate()}
                loading={deactivate.isPending}
              />
            ) : null}
          </Card>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
