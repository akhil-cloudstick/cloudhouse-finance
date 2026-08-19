import React, { useState } from "react";
import { FlatList, RefreshControl, Pressable, View } from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { colors, statusColors } from "../../../src/theme/colors";
import { listLoansPage } from "../../../src/api/loans";
import { Loan } from "../../../src/types/loan";
import { useDebouncedValue } from "../../../src/hooks/useDebouncedValue";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";

const PAGE_SIZE = 10;

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
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["loans", debouncedSearch],
    // Each page is its own API call — offset advances by PAGE_SIZE, never
    // an in-memory slice of one big fetch.
    queryFn: ({ pageParam = 0 }) =>
      listLoansPage({ q: debouncedSearch || undefined, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => (lastPage.hasMore ? pages.length * PAGE_SIZE : undefined),
  });

  // Silent — refetching on refocus (e.g. coming back from a loan detail
  // screen) shouldn't pop the pull-to-refresh spinner back up over a list
  // that's already showing loaded data. Only an explicit pull does that;
  // see `onRefresh` below, which is what RefreshControl's `refreshing` is
  // wired to instead of the query's own `isRefetching`.
  useRefetchOnFocus(refetch);

  async function onRefresh() {
    setManualRefreshing(true);
    try {
      await refetch();
    } finally {
      setManualRefreshing(false);
    }
  }

  const loans = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <ScreenContainer>
      <GoldTextInput
        label="Search loans"
        placeholder="Loan number or customer…"
        value={search}
        onChangeText={setSearch}
      />
      <FlatList<Loan>
        data={loans}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={manualRefreshing} onRefresh={onRefresh} />}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          <ThemedText color={colors.muted}>
            {isLoading ? "Loading…" : isError ? "Could not load loans." : "No loans found."}
          </ThemedText>
        }
        ListFooterComponent={isFetchingNextPage ? <ThemedText color={colors.muted}>Loading more…</ThemedText> : null}
        renderItem={({ item }) => {
          const tone = statusColors(toneForStatus(item.status));
          return (
            <Pressable onPress={() => router.push(`/loans/${item.id}`)}>
              <Card>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                  {/* "body" (Jost) instead of "h3" (Bodoni serif, wider per
                      glyph) — same fix as customers/index.tsx: h3 could clip
                      longer loan numbers against the Card's width. */}
                  <ThemedText variant="body">{item.loanNumber}</ThemedText>
                  <ThemedText
                    variant="label"
                    style={{
                      backgroundColor: tone.bg,
                      color: tone.fg,
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: 6,
                    }}
                  >
                    {item.status}
                  </ThemedText>
                </View>
                <ThemedText variant="small" color={colors.muted}>
                  {item.customer?.name ?? `Customer #${item.customerId}`}
                </ThemedText>
              </Card>
            </Pressable>
          );
        }}
      />
    </ScreenContainer>
  );
}
