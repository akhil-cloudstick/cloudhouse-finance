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
// come from the Loans module. The actual auction actions (eligible →
// notice → schedule → sale → settle) live on the loan's own detail screen
// (/loans/[id]) since every action is per-loan, not a separate resource.
//
// "Defaulted" is NOT filterable server-side: it's a read-time derived flag
// (Loan.isDefaulted, backend/internal/loan/model.go's IsDefaulted —
// gorm:"-"), never a value the persisted `status` column holds. Asking the
// backend for status=Defaulted silently returns zero rows every time —
// that's why this screen used to show no auctions at all. Instead we fetch
// the loans once and bucket client-side by isDefaulted vs. the real
// "Auction Eligible" status.
const FILTERS = ["Auction Eligible", "Defaulted"] as const;

export default function AuctionsScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Auction Eligible");

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["loans", "auctions"],
    queryFn: () => listLoans(),
  });

  const filtered = (data ?? []).filter((l) =>
    filter === "Defaulted" ? !!l.isDefaulted : l.status === "Auction Eligible"
  );

  // Pushing straight to `/loans/[id]` from outside the Loans tab leaves that
  // tab's Stack with the detail screen as its ONLY entry — see the matching
  // comment in dashboard.tsx. Pushing the list first builds the history
  // explicitly so back/the Loans tab land on the list, not stuck on detail.
  function openLoan(id: string | number) {
    router.push("/loans");
    router.push(`/loans/${id}`);
  }

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: 16 }}>
        <ChipSelect options={FILTERS} value={filter} onChange={setFilter} label="Filter" />
      </View>
      <FlatList<Loan>
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={
          <ThemedText color={colors.muted}>
            {isLoading ? "Loading…" : isError ? "Could not load loans." : "No loans found for this filter."}
          </ThemedText>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => openLoan(item.id)}>
            <Card>
              <ThemedText variant="body">{item.loanNumber}</ThemedText>
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
