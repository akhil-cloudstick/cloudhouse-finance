import React from "react";
import { FlatList, RefreshControl, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldButton } from "../../../src/components/GoldButton";
import { colors } from "../../../src/theme/colors";
import { listBranches } from "../../../src/api/branches";
import { Branch } from "../../../src/types/branch";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";

// No server-side search on this endpoint today (see src/api/branches.ts) —
// branch counts are small enough not to need one yet.
export default function BranchesScreen() {
  const router = useRouter();
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["branches"],
    queryFn: listBranches,
  });

  useRefetchOnFocus(refetch);

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: 16 }}>
        <GoldButton title="Add branch" variant="outline" onPress={() => router.push("/branches/new")} />
      </View>
      <FlatList<Branch>
        data={data ?? []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={
          <ThemedText color={colors.muted}>
            {isLoading ? "Loading…" : isError ? "Could not load branches." : "No branches found."}
          </ThemedText>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/branches/${item.id}`)}>
            <Card>
              <ThemedText variant="h3">{item.name}</ThemedText>
              <ThemedText variant="small" color={colors.muted}>
                {item.code || "—"} · {item.address}
              </ThemedText>
              <ThemedText variant="small" color={item.isActive ? colors.muted : colors.red}>
                {item.isActive ? "Active" : "Inactive"}
              </ThemedText>
            </Card>
          </Pressable>
        )}
      />
    </ScreenContainer>
  );
}
