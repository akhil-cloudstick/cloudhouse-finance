import React, { useState } from "react";
import { FlatList, RefreshControl, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { colors, statusColors } from "../../../src/theme/colors";
import { listSchemes } from "../../../src/api/schemes";
import { Scheme } from "../../../src/types/scheme";
import { useDebouncedValue } from "../../../src/hooks/useDebouncedValue";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";

export default function SchemesScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["schemes", debouncedSearch],
    queryFn: () => listSchemes(debouncedSearch || undefined),
  });

  useRefetchOnFocus(refetch);

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: 16 }}>
        <GoldTextInput label="Search schemes" value={search} onChangeText={setSearch} blur />
        <GoldButton title="+ New Scheme" variant="outline" onPress={() => router.push("/schemes/new")} />
      </View>

      <FlatList<Scheme>
        data={data ?? []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={
          <ThemedText color={colors.muted}>
            {isLoading ? "Loading…" : isError ? "Could not load schemes." : "No schemes found."}
          </ThemedText>
        }
        renderItem={({ item }) => {
          const tone = statusColors(item.isActive ? "green" : "muted");
          return (
            <Pressable onPress={() => router.push(`/schemes/${item.id}`)}>
              <Card>
                <ThemedText variant="h3">{item.name}</ThemedText>
                <ThemedText variant="small" color={colors.muted}>
                  {item.code} · {item.interestRate}% · {item.durationMonths}mo · LTV {item.ltvPercent}%
                </ThemedText>
                <ThemedText
                  variant="label"
                  style={{
                    marginTop: 8,
                    alignSelf: "flex-start",
                    backgroundColor: tone.bg,
                    color: tone.fg,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: 6,
                  }}
                >
                  {item.isActive ? "Active" : "Inactive"}
                </ThemedText>
              </Card>
            </Pressable>
          );
        }}
      />
    </ScreenContainer>
  );
}
