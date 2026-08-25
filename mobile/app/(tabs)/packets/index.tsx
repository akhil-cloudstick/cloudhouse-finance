import React, { useState } from "react";
import { FlatList, RefreshControl, Pressable, View } from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { colors, statusColors } from "../../../src/theme/colors";
import { listPacketsPage, getPacketByCode } from "../../../src/api/packets";
import { Packet } from "../../../src/types/packet";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";

const PAGE_SIZE = 10;

function toneForStatus(status: string) {
  if (status === "Released") return "green" as const;
  if (status === "Bank Pledged") return "blue" as const;
  if (status === "Ready For Release" || status === "Returned") return "amber" as const;
  return "muted" as const;
}

// Barcode/QR lookup (`by-code`) is a separate real endpoint from the
// status-filtered list — both are server-side, no client-side scanning of
// a full packet list to find a code.
export default function PacketsScreen() {
  const router = useRouter();
  // Arriving from a locker's detail screen (`/packets?lockerId=…`) scopes
  // this list to that locker's packets instead of the branch-wide list.
  const { lockerId: lockerIdParam } = useLocalSearchParams<{ lockerId?: string }>();
  const lockerId = lockerIdParam ? Number(lockerIdParam) : undefined;
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [code, setCode] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);

  const {
    data,
    isLoading,
    isError,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["packets", status, lockerId],
    queryFn: ({ pageParam = 0 }) => listPacketsPage({ status, lockerId, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => (lastPage.hasMore ? pages.length * PAGE_SIZE : undefined),
  });

  useRefetchOnFocus(refetch);

  const packets = data?.pages.flatMap((p) => p.items) ?? [];

  async function lookupByCode() {
    setLookupError(null);
    try {
      const packet = await getPacketByCode(code.trim());
      router.push(`/packets/${packet.id}`);
    } catch {
      setLookupError("No packet found for that code.");
    }
  }

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: 16 }}>
        <GoldTextInput label="Find by barcode/QR code" value={code} onChangeText={setCode} />
        {lookupError ? (
          <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
            {lookupError}
          </ThemedText>
        ) : null}
        <GoldButton title="Find packet" variant="outline" onPress={lookupByCode} disabled={!code} />
      </View>
      <FlatList<Packet>
        data={packets}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          <ThemedText color={colors.muted}>
            {isLoading ? "Loading…" : isError ? "Could not load packets." : "No packets found."}
          </ThemedText>
        }
        ListFooterComponent={isFetchingNextPage ? <ThemedText color={colors.muted}>Loading more…</ThemedText> : null}
        renderItem={({ item }) => {
          const tone = statusColors(toneForStatus(item.status));
          return (
            <Pressable onPress={() => router.push(`/packets/${item.id}`)}>
              <Card>
                <ThemedText variant="small">{item.code}</ThemedText>
                <ThemedText variant="small" color={colors.muted}>
                  {item.loan?.loanNumber ?? `Loan #${item.loanId}`}
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
