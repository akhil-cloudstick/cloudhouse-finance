import React, { useCallback, useEffect, useState } from "react";
import { View, FlatList, RefreshControl, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { ScreenContainer } from "@/common/components/layout/ScreenContainer";
import { Card } from "@/common/components/ui/Card";
import { ThemedText } from "@/common/components/ui/ThemedText";
import { FloatingHeader } from "@/common/components/layout/FloatingHeader";
import { BottomSheetModal } from "@/common/components/ui/BottomSheetModal";
import { NotificationList } from "@/common/components/NotificationList";
import { GoldButton } from "@/common/components/ui/GoldButton";
import { Icon } from "@/common/components/ui/Icon";
import { PaySheet } from "@/common/components/PaySheet";
import { colors } from "@/common/theme/colors";
import * as loansApi from "@/modules/loans/services/loanService";
import { Loan } from "@/modules/loans/services/loanService";
import * as paymentsApi from "@/modules/payments/services/paymentService";
import { LoanPayment } from "@/modules/payments/services/paymentService";
import { ApiError } from "@/common/services/httpClient";

const PAGE_SIZE = 10;

function money(n: number | undefined | null): string {
  return `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

// Payments tab per the Batch 3 plan: a "Pay a loan" card (loan picker + Pay
// Now, opening the same PaySheet as Loan Detail) and a paginated global
// payment history with a per-row receipt download/print button.
export default function PaymentsScreen() {
  const [notifOpen, setNotifOpen] = useState(false);

  // --- Pay-a-loan picker --------------------------------------------------
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loansLoading, setLoansLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [payOpen, setPayOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // No `status` filter — a customer may want to pay against any loan
        // that still carries a balance, not only "Active" ones.
        const res = await loansApi.listLoans({ limit: 50, offset: 0 });
        setLoans(res.items);
      } catch {
        setLoans([]);
      } finally {
        setLoansLoading(false);
      }
    })();
  }, []);

  async function refreshSelectedLoan() {
    if (!selectedLoan) return;
    try {
      const fresh = await loansApi.getLoan(selectedLoan.id);
      setSelectedLoan(fresh);
    } catch {
      // Keep the stale copy — the payment history reload below still
      // reflects the new payment even if this refetch fails.
    }
    loadHistory(0, true);
  }

  // --- Payment history (paginated, all loans) -----------------------------
  const [items, setItems] = useState<LoanPayment[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const loadHistory = useCallback(async (offset: number, replace: boolean) => {
    if (replace) setHistoryLoading((prev) => (offset === 0 ? prev : false));
    try {
      const res = await paymentsApi.listPayments({ limit: PAGE_SIZE, offset });
      setItems((prev) => (replace ? res.items : [...prev, ...res.items]));
      setHasMore(res.hasMore);
    } catch {
      if (replace) {
        setItems([]);
        setHasMore(false);
      }
    } finally {
      setHistoryLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    loadHistory(0, true);
  }, [loadHistory]);

  async function onRefresh() {
    setRefreshing(true);
    await loadHistory(0, true);
  }

  async function onEndReached() {
    if (!hasMore || loadingMore || historyLoading) return;
    setLoadingMore(true);
    await loadHistory(items.length, false);
  }

  async function downloadReceipt(payment: LoanPayment) {
    setDownloadingId(payment.id);
    try {
      const { url, headers } = await paymentsApi.getReceiptDownloadInfo(payment.id);
      const destination = new File(Paths.cache, `receipt-${payment.id}.pdf`);
      const file = await File.downloadFileAsync(url, destination, { headers, idempotent: true });
      try {
        await Print.printAsync({ uri: file.uri });
      } catch {
        // Some Android configurations reject printAsync's uri path — fall
        // back to the plain share sheet so the receipt is still reachable.
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(file.uri);
        }
      }
    } catch {
      // Best-effort: leave the row as-is, the customer can retry the tap.
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FloatingHeader title="Payments" navigation={undefined} onBellPress={() => setNotifOpen(true)} />
      <ScreenContainer style={{ paddingHorizontal: 0 }}>
        <View style={{ paddingHorizontal: 16 }}>
          <Card blur>
            <ThemedText variant="h3" style={{ marginBottom: 10 }}>
              Pay a loan
            </ThemedText>
            <Pressable onPress={() => setPickerOpen(true)} style={styles.pickerField}>
              <ThemedText variant="body" color={selectedLoan ? colors.ink : colors.muted}>
                {selectedLoan ? selectedLoan.loanNumber : "Select loan"}
              </ThemedText>
              <View style={{ transform: [{ rotate: "-90deg" }] }}>
                <Icon name="chevronLeft" size={16} color={colors.muted} />
              </View>
            </Pressable>
            <GoldButton
              title="Pay Now"
              onPress={() => setPayOpen(true)}
              disabled={!selectedLoan}
              style={{ marginTop: 12 }}
            />
          </Card>
        </View>

        <View style={{ paddingHorizontal: 16, marginTop: 8, marginBottom: 4 }}>
          <ThemedText variant="h3">Payment History</ThemedText>
        </View>

        <FlatList<LoanPayment>
          data={items}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingHorizontal: 16, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            historyLoading ? (
              <ActivityIndicator color={colors.brand} style={{ marginTop: 24 }} />
            ) : (
              <Card blur>
                <ThemedText color={colors.muted}>No payments yet</ThemedText>
              </Card>
            )
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={colors.brand} style={{ marginVertical: 12 }} /> : null
          }
          renderItem={({ item }) => (
            <Card blur>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1 }}>
                  <ThemedText variant="body">
                    {item.loanNumber ?? `Loan #${item.loanId}`} · {money(item.amount)}
                  </ThemedText>
                  <ThemedText variant="small" color={colors.muted}>
                    {new Date(item.paidOn).toLocaleDateString("en-IN")} · {item.type} · {item.method}
                  </ThemedText>
                </View>
                <Pressable onPress={() => downloadReceipt(item)} hitSlop={10} disabled={downloadingId === item.id}>
                  {downloadingId === item.id ? (
                    <ActivityIndicator color={colors.brand} size="small" />
                  ) : (
                    <Icon name="doc" size={20} color={colors.brandDeep} />
                  )}
                </Pressable>
              </View>
            </Card>
          )}
        />
      </ScreenContainer>

      <BottomSheetModal visible={pickerOpen} onClose={() => setPickerOpen(false)} maxHeightPct={60}>
        <ThemedText variant="h3" style={{ marginBottom: 12 }}>
          Select a loan
        </ThemedText>
        {loansLoading ? (
          <ActivityIndicator color={colors.brand} />
        ) : loans.length ? (
          loans.map((l) => (
            <Pressable
              key={l.id}
              onPress={() => {
                setSelectedLoan(l);
                setPickerOpen(false);
              }}
              style={styles.pickerRow}
            >
              <View>
                <ThemedText variant="body">{l.loanNumber}</ThemedText>
                <ThemedText variant="small" color={colors.muted}>
                  Outstanding {money(l.totalOutstandingBalance ?? l.outstandingAmount)}
                </ThemedText>
              </View>
            </Pressable>
          ))
        ) : (
          <ThemedText variant="small" color={colors.muted}>
            No loans found.
          </ThemedText>
        )}
      </BottomSheetModal>

      {selectedLoan ? (
        <PaySheet visible={payOpen} onClose={() => setPayOpen(false)} loan={selectedLoan} onPaid={refreshSelectedLoan} />
      ) : null}

      <BottomSheetModal visible={notifOpen} onClose={() => setNotifOpen(false)} maxHeightPct={60} dragToClose={false}>
        <NotificationList />
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  pickerField: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
  },
  pickerRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
});
