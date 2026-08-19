import React, { useCallback, useEffect, useState } from "react";
import { View, FlatList, RefreshControl, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../src/components/ScreenContainer";
import { Card } from "../../src/components/Card";
import { ThemedText } from "../../src/components/ThemedText";
import { FloatingHeader } from "../../src/components/FloatingHeader";
import { BottomSheetModal } from "../../src/components/BottomSheetModal";
import { NotificationList } from "../../src/components/NotificationList";
import { ChipSelect } from "../../src/components/ChipSelect";
import { colors, statusColors } from "../../src/theme/colors";
import * as loansApi from "../../src/api/loans";
import { Loan } from "../../src/api/loans";

const PAGE_SIZE = 10;

// Filter chip labels shown to the customer -> the `status` query param sent
// to GET /customer/loans (omitted entirely for "All"). Each tap is its own
// server-side call from offset 0 — never an in-memory filter of one fetched
// list, per the plan's decision.
const FILTERS = ["All", "Active", "Due Soon", "Overdue", "Closed"] as const;
type FilterLabel = (typeof FILTERS)[number];

function statusParamFor(filter: FilterLabel): string | undefined {
  return filter === "All" ? undefined : filter;
}

function toneForStatus(status: string): "green" | "red" | "amber" | "blue" | "muted" {
  const s = status.toLowerCase();
  if (s.includes("closed")) return "green";
  if (s.includes("overdue") || s.includes("default")) return "red";
  if (s.includes("due soon")) return "amber";
  if (s.includes("active")) return "blue";
  return "muted";
}

export default function LoansScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterLabel>("All");
  const [notifOpen, setNotifOpen] = useState(false);

  const [items, setItems] = useState<Loan[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadPage = useCallback(async (status: string | undefined, offset: number) => {
    return loansApi.listLoans({ status, limit: PAGE_SIZE, offset });
  }, []);

  // Re-fetches from offset 0 whenever the filter changes — a real new
  // network request every time, not a client-side re-slice.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await loadPage(statusParamFor(filter), 0);
        if (!cancelled) {
          setItems(res.items);
          setHasMore(res.hasMore);
        }
      } catch {
        if (!cancelled) {
          setItems([]);
          setHasMore(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, loadPage]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      const res = await loadPage(statusParamFor(filter), 0);
      setItems(res.items);
      setHasMore(res.hasMore);
    } catch {
      // Keep whatever was already on screen — a failed refresh shouldn't
      // wipe the list.
    } finally {
      setRefreshing(false);
    }
  }

  async function onEndReached() {
    if (!hasMore || loadingMore || loading) return;
    setLoadingMore(true);
    try {
      const res = await loadPage(statusParamFor(filter), items.length);
      setItems((prev) => [...prev, ...res.items]);
      setHasMore(res.hasMore);
    } catch {
      // Leave hasMore as-is — the next onEndReached retries.
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <FloatingHeader title="My Loans" navigation={undefined} onBellPress={() => setNotifOpen(true)} />
      <ScreenContainer>
        <ChipSelect options={FILTERS} value={filter} onChange={setFilter} />

        <FlatList<Loan>
          data={items}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator color={colors.gold} style={{ marginTop: 24 }} />
            ) : (
              <Card>
                <ThemedText color={colors.muted}>No loans found</ThemedText>
              </Card>
            )
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={colors.gold} style={{ marginVertical: 12 }} /> : null
          }
          renderItem={({ item }) => {
            const tone = statusColors(toneForStatus(item.status));
            return (
              <Pressable onPress={() => router.push(`/loan/${item.id}`)}>
                <Card>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
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
                      {item.status.toUpperCase()}
                    </ThemedText>
                  </View>
                  <ThemedText variant="small" color={colors.muted} style={{ marginTop: 4 }}>
                    Opened {new Date(item.openedDate).toLocaleDateString("en-IN")}
                  </ThemedText>
                  <ThemedText variant="body" color={colors.goldDeep} style={{ marginTop: 6 }}>
                    Outstanding ₹{(item.totalOutstandingBalance ?? item.outstandingAmount).toLocaleString("en-IN")}
                  </ThemedText>
                  <ThemedText variant="small" color={colors.muted}>
                    {item.isOverdue
                      ? `${item.daysOverdue ?? 0} days overdue`
                      : `Due ${new Date(item.dueDate).toLocaleDateString("en-IN")}`}
                  </ThemedText>
                </Card>
              </Pressable>
            );
          }}
        />
      </ScreenContainer>

      <BottomSheetModal visible={notifOpen} onClose={() => setNotifOpen(false)} maxHeightPct={60} dragToClose={false}>
        <NotificationList />
      </BottomSheetModal>
    </View>
  );
}
