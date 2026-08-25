import React, { useState } from "react";
import { ScrollView, View, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../src/components/ScreenContainer";
import { Card } from "../../src/components/Card";
import { ThemedText } from "../../src/components/ThemedText";
import { FloatingHeader } from "../../src/components/FloatingHeader";
import { BottomSheetModal } from "../../src/components/BottomSheetModal";
import { NotificationList } from "../../src/components/NotificationList";
import { colors } from "../../src/theme/colors";
import { useAuth } from "../../src/auth/AuthContext";
import * as goldRateApi from "../../src/api/goldRate";
import { GoldRate } from "../../src/api/goldRate";
import * as loansApi from "../../src/api/loans";
import { Loan } from "../../src/api/loans";

function money(n: number | undefined | null): string {
  return `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

// A loan still carries an active balance for KPI purposes unless it's
// reached one of these terminal states — mirrors the same "not yet closed"
// notion the backend's FindOpenForCalendar/loans list filters use.
function isOpenLoan(l: Loan): boolean {
  return l.status !== "Closed" && l.status !== "Rejected" && l.status !== "Auctioned";
}

// Dashboard/Home: a gold-rate widget (tap -> rise-up modal with history),
// real My Loans/Reminders summary cards sourced from GET /customer/loans
// (no separate summary endpoint needed — the loan list already carries
// status/outstanding/isDueSoon/isOverdue/dueDate for every loan), and a
// notification bell.
export default function HomeScreen() {
  const { customer } = useAuth();
  const router = useRouter();
  const [ratesOpen, setRatesOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const [latest, setLatest] = useState<GoldRate | null>(null);
  const [latestLoading, setLatestLoading] = useState(true);
  const [history, setHistory] = useState<GoldRate[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [loans, setLoans] = useState<Loan[]>([]);
  const [loansLoading, setLoansLoading] = useState(true);

  React.useEffect(() => {
    (async () => {
      try {
        const rate = await goldRateApi.getLatest();
        setLatest(rate);
      } catch {
        setLatest(null);
      } finally {
        setLatestLoading(false);
      }
    })();
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        const rec = await loansApi.listAllLoans();
        setLoans(rec);
      } catch {
        setLoans([]);
      } finally {
        setLoansLoading(false);
      }
    })();
  }, []);

  const openLoans = loans.filter(isOpenLoan);
  const totalOutstanding = openLoans.reduce((sum, l) => sum + (l.totalOutstandingBalance ?? l.outstandingAmount ?? 0), 0);
  const dueSoonLoans = openLoans.filter((l) => l.isDueSoon);
  const overdueLoans = openLoans.filter((l) => l.isOverdue);
  // Nearest upcoming due date across every open loan — the single most
  // useful thing to surface on a summary card without listing every loan.
  const nextDue = openLoans
    .filter((l) => !l.isOverdue)
    .slice()
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];

  async function openRates() {
    setRatesOpen(true);
    setHistoryLoading(true);
    try {
      const res = await goldRateApi.getHistory(30);
      setHistory(res.items);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <FloatingHeader title="Home" navigation={undefined} onBellPress={() => setNotifOpen(true)} />
      <ScreenContainer>
        <ScrollView showsVerticalScrollIndicator={false}>
          <ThemedText variant="h2" color={colors.goldDeep}>
            Welcome{customer?.name ? `, ${customer.name}` : ""}
          </ThemedText>
          <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 16 }}>
            Here's a quick look at your account.
          </ThemedText>

          <Pressable onPress={openRates}>
            <Card>
              <ThemedText variant="label" color={colors.muted}>
                24K Gold Rate
              </ThemedText>
              {latestLoading ? (
                <ActivityIndicator color={colors.gold} style={{ alignSelf: "flex-start", marginTop: 6 }} />
              ) : latest ? (
                <>
                  <ThemedText variant="h1" color={colors.goldDeep}>
                    ₹{latest.k24.toLocaleString("en-IN")}
                  </ThemedText>
                  <ThemedText variant="small" color={colors.muted}>
                    as of {new Date(latest.date).toLocaleDateString("en-IN")} · tap for history
                  </ThemedText>
                </>
              ) : (
                <ThemedText variant="body" color={colors.muted}>
                  Rate unavailable right now.
                </ThemedText>
              )}
            </Card>
          </Pressable>

          <Pressable onPress={() => router.push("/(tabs)/loans")}>
            <Card>
              <ThemedText variant="h3" style={{ marginBottom: 4 }}>
                My Loans
              </ThemedText>
              {loansLoading ? (
                <ActivityIndicator color={colors.gold} style={{ alignSelf: "flex-start", marginTop: 4 }} />
              ) : openLoans.length ? (
                <>
                  <View style={styles.kpiRow}>
                    <View style={styles.kpiCell}>
                      <ThemedText variant="h2" color={colors.goldDeep}>
                        {openLoans.length}
                      </ThemedText>
                      <ThemedText variant="small" color={colors.muted}>
                        Active {openLoans.length === 1 ? "loan" : "loans"}
                      </ThemedText>
                    </View>
                    <View style={styles.kpiCell}>
                      <ThemedText variant="h2" color={colors.goldDeep}>
                        {money(totalOutstanding)}
                      </ThemedText>
                      <ThemedText variant="small" color={colors.muted}>
                        Total outstanding
                      </ThemedText>
                    </View>
                  </View>
                  <ThemedText variant="small" color={colors.muted} style={{ marginTop: 8 }}>
                    Tap to view all loans
                  </ThemedText>
                </>
              ) : (
                <ThemedText variant="small" color={colors.muted}>
                  No loans on your account yet.
                </ThemedText>
              )}
            </Card>
          </Pressable>

          <Pressable onPress={() => router.push("/(tabs)/loans")}>
            <Card blur>
              <ThemedText variant="h3" style={{ marginBottom: 4 }}>
                Reminders
              </ThemedText>
              {loansLoading ? (
                <ActivityIndicator color={colors.gold} style={{ alignSelf: "flex-start", marginTop: 4 }} />
              ) : overdueLoans.length || dueSoonLoans.length ? (
                <>
                  {overdueLoans.length ? (
                    <ThemedText variant="body" color={colors.red} style={{ marginTop: 4 }}>
                      {overdueLoans.length} {overdueLoans.length === 1 ? "loan is" : "loans are"} overdue
                    </ThemedText>
                  ) : null}
                  {dueSoonLoans.length ? (
                    <ThemedText variant="body" color={colors.amber} style={{ marginTop: 4 }}>
                      {dueSoonLoans.length} {dueSoonLoans.length === 1 ? "loan is" : "loans are"} due soon
                    </ThemedText>
                  ) : null}
                  {nextDue ? (
                    <ThemedText variant="small" color={colors.muted} style={{ marginTop: 6 }}>
                      Next due: {nextDue.loanNumber} on {new Date(nextDue.dueDate).toLocaleDateString("en-IN")}
                    </ThemedText>
                  ) : null}
                </>
              ) : (
                <ThemedText variant="small" color={colors.muted}>
                  No upcoming due dates — you're all caught up.
                </ThemedText>
              )}
            </Card>
          </Pressable>
        </ScrollView>
      </ScreenContainer>

      <BottomSheetModal visible={ratesOpen} onClose={() => setRatesOpen(false)}>
        <ThemedText variant="h3" style={{ marginBottom: 12 }}>
          Gold Rates
        </ThemedText>
        {latest ? (
          <View style={styles.currentRateBox}>
            <ThemedText variant="label" color={colors.muted}>
              Current 24K Rate
            </ThemedText>
            <ThemedText variant="h2" color={colors.goldDeep}>
              ₹{latest.k24.toLocaleString("en-IN")}
            </ThemedText>
          </View>
        ) : null}
        <ThemedText variant="label" color={colors.muted} style={{ marginBottom: 8 }}>
          Recent history
        </ThemedText>
        <ScrollView style={{ maxHeight: 320 }}>
          {historyLoading ? (
            <ActivityIndicator color={colors.gold} />
          ) : history.length ? (
            history.map((r) => (
              <View key={r.id} style={styles.historyRow}>
                <ThemedText variant="body">{new Date(r.date).toLocaleDateString("en-IN")}</ThemedText>
                <ThemedText variant="body" color={colors.goldDeep}>
                  ₹{r.k24.toLocaleString("en-IN")}
                </ThemedText>
              </View>
            ))
          ) : (
            <ThemedText variant="small" color={colors.muted}>
              No history available.
            </ThemedText>
          )}
        </ScrollView>
      </BottomSheetModal>

      <BottomSheetModal visible={notifOpen} onClose={() => setNotifOpen(false)} maxHeightPct={60} dragToClose={false}>
        <NotificationList />
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  kpiRow: { flexDirection: "row", gap: 20, marginTop: 4 },
  kpiCell: { flex: 1 },
  currentRateBox: {
    backgroundColor: colors.goldPale,
    borderWidth: 1,
    borderColor: colors.goldLight,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  historyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
});
