import React, { useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable } from "react-native";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { colors } from "../../../src/theme/colors";
import { listCustomers } from "../../../src/api/customers";
import { Customer } from "../../../src/types/customer";
import { useDebouncedValue } from "../../../src/hooks/useDebouncedValue";

export default function CustomersScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);

  // Every keystroke (after debounce) re-queries the backend with `q` —
  // no in-memory filtering of a full customer list.
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["customers", debouncedSearch],
    queryFn: () => listCustomers(debouncedSearch || undefined),
  });

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <GoldTextInput
        label="Search customers"
        placeholder="Name, phone, or code…"
        value={search}
        onChangeText={setSearch}
        containerStyle={{ marginHorizontal: 16 }}
      />
      <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
        <GoldButton title="+ Register customer" onPress={() => router.push("/customers/new")} />
      </View>
      <FlatList<Customer>
        data={data ?? []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={
          <ThemedText color={colors.muted}>
            {isLoading ? "Loading…" : isError ? "Could not load customers." : "No customers found."}
          </ThemedText>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/customers/${item.id}`)}>
            <Card>
              {/* h3 is Bodoni serif at 18px and was getting cropped for long
                  names (typography.ts:15) — "body" (Jost 15px) fits the
                  Card width without truncation. */}
              <ThemedText variant="body">{item.name}</ThemedText>
              <ThemedText variant="small" color={colors.muted}>
                {item.code} · {item.phone}
              </ThemedText>
            </Card>
          </Pressable>
        )}
      />
    </ScreenContainer>
  );
}
