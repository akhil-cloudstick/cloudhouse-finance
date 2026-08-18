import React from "react";
import { FlatList, RefreshControl, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldButton } from "../../../src/components/GoldButton";
import { colors } from "../../../src/theme/colors";
import { listEmployees } from "../../../src/api/employees";
import { Employee } from "../../../src/types/employee";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";

// No server-side search on this endpoint today (see src/api/employees.ts) —
// list is already branch-scoped, small enough not to need one yet.
export default function EmployeesScreen() {
  const router = useRouter();
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["employees"],
    queryFn: listEmployees,
  });

  useRefetchOnFocus(refetch);

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: 16 }}>
        <GoldButton title="Add employee" variant="outline" onPress={() => router.push("/employees/new")} />
      </View>
      <FlatList<Employee>
        data={data ?? []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={
          <ThemedText color={colors.muted}>
            {isLoading ? "Loading…" : isError ? "Could not load employees." : "No employees found."}
          </ThemedText>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/employees/${item.id}`)}>
            <Card>
              <ThemedText variant="body">{item.name}</ThemedText>
              <ThemedText variant="small" color={colors.muted}>
                {item.code} · {item.role}
              </ThemedText>
            </Card>
          </Pressable>
        )}
      />
    </ScreenContainer>
  );
}
