import React, { useState } from "react";
import { FlatList, RefreshControl, Pressable, View } from "react-native";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { ChipSelect } from "../../../src/components/ChipSelect";
import { colors } from "../../../src/theme/colors";
import { listLoans } from "../../../src/api/loans";
import { listConcludedAuctions } from "../../../src/api/auctions";
import { Loan } from "../../../src/types/loan";
import { AuctionRecord } from "../../../src/types/auction";
import { fmt } from "../../../src/lib/format";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";

const PAGE_SIZE = 10;

// There's no dedicated "auctions" list endpoint for the Active tab —
// eligible/defaulted loans come from the Loans module. The actual auction
// actions (eligible → notice → schedule → sale → settle) live on the loan's
// own detail screen (/loans/[id]) since every action is per-loan, not a
// separate resource.
//
// "Defaulted" is NOT filterable server-side: it's a read-time derived flag
// (Loan.isDefaulted, backend/internal/loan/model.go's IsDefaulted —
// gorm:"-"), never a value the persisted `status` column holds. Asking the
// backend for status=Defaulted silently returns zero rows every time —
// that's why this screen used to show no auctions at all. Instead we fetch
// the loans once and bucket client-side by isDefaulted vs. the real
// "Auction Eligible" status.
const FILTERS = ["Auction Eligible", "Defaulted"] as const;

// Mirrors frontend/components/Auctions.tsx's Active Cases / Auction History
// split — the mobile screen used to be Active-only. History reuses the same
// paginated {items, hasMore} endpoint (handler.go's ListConcludedAuctions)
// the web app's two tables page independently.
const TOP_TABS = ["Active Cases", "Auction History"] as const;
const HISTORY_TABLES = ["Auctions Conducted", "Closed Without Auction"] as const;

export default function AuctionsScreen() {
  const [topTab, setTopTab] = useState<(typeof TOP_TABS)[number]>("Active Cases");

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: 16 }}>
        <ChipSelect options={TOP_TABS} value={topTab} onChange={setTopTab} />
      </View>
      {topTab === "Active Cases" ? <ActiveCases /> : <AuctionHistory />}
    </ScreenContainer>
  );
}

function ActiveCases() {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Auction Eligible");

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["loans", "auctions"],
    queryFn: () => listLoans(),
  });

  useRefetchOnFocus(refetch);

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
    <>
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
              <View style={{ flexDirection: "row", gap: 12, marginTop: 6 }}>
                <ThemedText variant="small" color={colors.muted}>
                  Gold {item.totalNetWeight?.toFixed(2) ?? "—"} g
                </ThemedText>
                <ThemedText variant="small" color={colors.muted}>
                  Outstanding ₹{fmt(item.totalOutstandingBalance ?? item.outstandingAmount)}
                </ThemedText>
                {item.daysOverdue ? (
                  <ThemedText variant="small" color={colors.red}>
                    {item.daysOverdue}d overdue
                  </ThemedText>
                ) : null}
              </View>
            </Card>
          </Pressable>
        )}
      />
    </>
  );
}

function AuctionHistory() {
  const [table, setTable] = useState<(typeof HISTORY_TABLES)[number]>("Auctions Conducted");
  const hasSale = table === "Auctions Conducted";

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
    queryKey: ["auctionHistory", hasSale],
    queryFn: ({ pageParam = 0 }) => listConcludedAuctions({ hasSale, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => (lastPage.hasMore ? pages.length * PAGE_SIZE : undefined),
  });

  useRefetchOnFocus(refetch);

  const records = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <View style={{ paddingHorizontal: 16 }}>
        <ChipSelect options={HISTORY_TABLES} value={table} onChange={setTable} label="Table" />
      </View>
      {/* Column headers — a lightweight stand-in for the web app's real
          <table>; RN has no table primitive, so each row below repeats
          these same four fields in the same order. */}
      <View style={{ flexDirection: "row", paddingHorizontal: 16, marginBottom: 4 }}>
        <ThemedText variant="label" color={colors.muted} style={{ flex: 1 }}>
          LOAN
        </ThemedText>
        <ThemedText variant="label" color={colors.muted} style={{ flex: 1 }}>
          STAGE
        </ThemedText>
        <ThemedText variant="label" color={colors.muted} style={{ flex: 1, textAlign: "right" }}>
          SALE
        </ThemedText>
        <ThemedText variant="label" color={colors.muted} style={{ flex: 1, textAlign: "right" }}>
          SURPLUS/SHORT
        </ThemedText>
      </View>
      <FlatList<AuctionRecord>
        data={records}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          <ThemedText color={colors.muted}>
            {isLoading ? "Loading…" : isError ? "Could not load auction history." : "No concluded auctions."}
          </ThemedText>
        }
        ListFooterComponent={isFetchingNextPage ? <ThemedText color={colors.muted}>Loading more…</ThemedText> : null}
        renderItem={({ item }) => (
          <Card style={{ flexDirection: "row" }}>
            <ThemedText variant="small" style={{ flex: 1 }}>
              Loan #{item.loanId}
            </ThemedText>
            <ThemedText variant="small" color={colors.muted} style={{ flex: 1 }}>
              {item.stage}
            </ThemedText>
            <ThemedText variant="small" style={{ flex: 1, textAlign: "right" }}>
              {item.saleAmount ? `₹${fmt(item.saleAmount)}` : "—"}
            </ThemedText>
            <ThemedText
              variant="small"
              color={item.surplusShortfall && item.surplusShortfall < 0 ? colors.red : colors.muted}
              style={{ flex: 1, textAlign: "right" }}
            >
              {item.surplusShortfall ? `₹${fmt(item.surplusShortfall)}` : "—"}
            </ThemedText>
          </Card>
        )}
      />
    </>
  );
}
