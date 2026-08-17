import React, { useState } from "react";
import { FlatList, RefreshControl, Pressable } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { colors, statusColors } from "../../../src/theme/colors";
import { listLoans } from "../../../src/api/loans";
import { Loan } from "../../../src/types/loan";
import { useDebouncedValue } from "../../../src/hooks/useDebouncedValue";

function toneForStatus(status: string): "green" | "red" | "amber" | "blue" | "muted" {
  const s = status.toLowerCase();
  if (s.includes("approved") || s.includes("closed")) return "green";
  if (s.includes("reject") || s.includes("default")) return "red";
  if (s.includes("pending")) return "amber";
  return "blue";
}

export default function LoansScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["loans", debouncedSearch],
    queryFn: () => listLoans({ q: debouncedSearch || undefined }),
  });

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <GoldTextInput
        label="Search loans"
        placeholder="Loan number or customer…"
        value={search}
        onChangeText={setSearch}
        containerStyle={{ marginHorizontal: 16 }}
      />
      <FlatList<Loan>
        data={data ?? []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={
          <ThemedText color={colors.muted}>
            {isLoading ? "Loading…" : isError ? "Could not load loans." : "No loans found."}
          </ThemedText>
        }
        renderItem={({ item }) => {
          const tone = statusColors(toneForStatus(item.status));
          return (
            <Pressable onPress={() => router.push(`/loans/${item.id}`)}>
              <Card>
                {/* "body" (Jost) instead of "h3" (Bodoni serif, wider per
                    glyph) — same fix as customers/index.tsx: h3 could clip
                    longer loan numbers against the Card's width. */}
                <ThemedText variant="body">{item.loanNumber}</ThemedText>
                <ThemedText variant="small" color={colors.muted}>
                  {item.customer?.name ?? `Customer #${item.customerId}`}
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
                  {item.status}
                </ThemedText>
              </Card>
            </Pressable>
          );
        }}
      />
    </ScreenContainer>
  );
}
