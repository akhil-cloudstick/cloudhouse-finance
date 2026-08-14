import React, { useState } from "react";
import { FlatList, RefreshControl, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { ChipSelect } from "../../../src/components/ChipSelect";
import { colors } from "../../../src/theme/colors";
import { listLoans } from "../../../src/api/loans";
import { Loan } from "../../../src/types/loan";

// There's no dedicated "auctions" list endpoint — eligible/defaulted loans
// come from the Loans module's own status filter (see plan). The actual
// auction actions (eligible → notice → schedule → sale → settle) live on
// the loan's own detail screen (/loans/[id]) since every action is
// per-loan, not a separate resource.
const STATUSES = ["Auction Eligible", "Defaulted"] as const;

export default function AuctionsScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("Auction Eligible");

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["loans", "auction-status", status],
    queryFn: () => listLoans({ status }),
  });

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: 16 }}>
        <ChipSelect options={STATUSES} value={status} onChange={setStatus} label="Filter" />
      </View>
      <FlatList<Loan>
        data={data ?? []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={
          <ThemedText color={colors.muted}>
            {isLoading ? "Loading…" : isError ? "Could not load loans." : "No loans found for this filter."}
          </ThemedText>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/loans/${item.id}`)}>
            <Card>
              <ThemedText variant="h3">{item.loanNumber}</ThemedText>
              <ThemedText variant="small" color={colors.muted}>
                {item.customer?.name ?? `Customer #${item.customerId}`} · {item.status}
              </ThemedText>
            </Card>
          </Pressable>
        )}
      />
    </ScreenContainer>
  );
}
