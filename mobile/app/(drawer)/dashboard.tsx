import React, { useState } from "react";
import { ScrollView, View, Pressable, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../src/components/ScreenContainer";
import { Card } from "../../src/components/Card";
import { ThemedText } from "../../src/components/ThemedText";
import { ChipSelect } from "../../src/components/ChipSelect";
import { GoldTextInput } from "../../src/components/GoldTextInput";
import { colors, statusColors, StatusTone } from "../../src/theme/colors";
import { useAuth } from "../../src/auth/AuthContext";
import { latestGoldRate } from "../../src/api/goldRates";
import { getCalendarEvents } from "../../src/api/reminders";
import { listLoans, listLoanRequests } from "../../src/api/loans";
import { getCashSummary, listExpenses } from "../../src/api/cash";
import { listPurityStandards } from "../../src/api/purityStandards";
import { listSchemes } from "../../src/api/schemes";
import { CalendarEvent } from "../../src/types/reminder";

import { fmt } from "../../src/lib/format";

// Mirrors backend/internal/loan/purity.go's ParsePurity/rateForPurity, same
// as frontend/lib/purity.ts's rateForPurityString — kept local here since
// mobile has no shared purity-math module yet (see purityStandards.ts).
function rateForPurityString(k24: number, purity: string): number | null {
  const karatMatch = /^(\d+)K$/.exec(purity);
  if (karatMatch) {
    const karat = Number(karatMatch[1]);
    return karat >= 10 && karat <= 24 ? Math.round((k24 * karat) / 24) : null;
  }
  const finenessMatch = /^(\d+(?:\.\d+)?)%$/.exec(purity);
  if (finenessMatch) {
    const fineness = Number(finenessMatch[1]);
    return fineness > 0 && fineness <= 100 ? Math.round((k24 * fineness) / 100) : null;
  }
  return null;
}

const EXPENSE_COLORS = [colors.goldDeep, colors.goldMid, colors.blue, colors.green, colors.red, colors.amber];

function toneForType(type: CalendarEvent["type"]): StatusTone {
  if (type === "Overdue") return "red";
  if (type === "LoanDue" || type === "InterestDue") return "amber";
  if (type === "PromiseToPay") return "blue";
  return "muted";
}

// Every module now has its own sidebar entry (app/(drawer)/_layout.tsx) —
// this screen only shows KPIs/summaries, not a link grid. Ported from
// frontend/components/Dashboard.tsx's "Business Overview" — see that file
// for the reference layout (KPI row, disbursement bars, Needs Attention,
// gold-loan calculator, upcoming reminders, expense summary). Interest
// Collected is skipped: mobile has no getInterestCollected()-equivalent API
// yet (frontend/lib/loansApi.ts's getInterestCollected has no mobile
// counterpart in mobile/src/api/*.ts).
export default function DashboardScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const branchId = employee?.branchId;
  const today = new Date().toISOString().slice(0, 10);

  const goldRate = useQuery({ queryKey: ["gold-rates", "latest"], queryFn: latestGoldRate });
  const events = useQuery({ queryKey: ["reminders", "calendar"], queryFn: () => getCalendarEvents() });
  const loans = useQuery({ queryKey: ["loans", "all"], queryFn: () => listLoans() });
  const expenses = useQuery({ queryKey: ["expenses", "all"], queryFn: listExpenses });
  const requests = useQuery({
    queryKey: ["loans", "requests", "pending"],
    queryFn: () => listLoanRequests({ status: "Pending" }),
  });
  const purityStandards = useQuery({ queryKey: ["purity-standards", "all"], queryFn: () => listPurityStandards() });
  const schemes = useQuery({ queryKey: ["schemes", "all"], queryFn: () => listSchemes() });
  const cashSummary = useQuery({
    queryKey: ["cash", "summary", branchId, today],
    queryFn: () => getCashSummary(branchId!, today),
    enabled: !!branchId,
  });

  const dueTodayCount =
    events.data?.filter((e) => e.type === "LoanDue" && e.date === today).length ?? 0;

  const loanList = loans.data ?? [];
  const activeCount = loanList.filter((l) => ["Active", "Due Soon", "Overdue"].includes(l.status)).length;
  const overdueCount = loanList.filter((l) => l.status === "Overdue").length;
  const dueSoonCount = loanList.filter((l) => l.status === "Due Soon").length;
  const pendingApprovalLoans = loanList.filter((l) => l.status === "Pending Approval");
  const auctionLoans = loanList.filter((l) => l.status === "Auction Eligible" || l.status === "Defaulted");
  const openedTodayCount = loanList.filter((l) => l.openedDate === today).length;
  const pledgedLoans = loanList.filter((l) => l.bankPledgeStatus === "Bank Pledged");

  const requestList = requests.data ?? [];
  const extensionCount = requestList.filter((r) => r.type === "Extension").length;
  const releaseCount = requestList.filter((r) => r.type === "Release").length;

  const expToday = (expenses.data ?? [])
    .filter((e) => e.occurredOn === today)
    .reduce((s, e) => s + e.amount, 0);
  const expPendingCount = (expenses.data ?? []).filter((e) => e.status === "Pending").length;

  // Last 6 months' disbursement, in lakhs — grouped client-side from the
  // already-fetched loan list (mirrors frontend/components/Dashboard.tsx's
  // monthBuckets logic exactly).
  const now = new Date();
  const monthBuckets: [string, number][] = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return [d.toLocaleDateString("en-IN", { month: "short" }), 0] as [string, number];
  });
  loanList.forEach((l) => {
    const opened = new Date(l.openedDate);
    const idx = 5 - ((now.getFullYear() - opened.getFullYear()) * 12 + (now.getMonth() - opened.getMonth()));
    if (idx >= 0 && idx < 6) monthBuckets[idx][1] += l.principalAmount / 100000;
  });
  const maxBar = Math.max(1, ...monthBuckets.map(([, v]) => v));

  const upcomingReminders = [...(events.data ?? [])]
    .sort((a, b) => (a.type === "Overdue" ? -1 : b.type === "Overdue" ? 1 : a.date.localeCompare(b.date)))
    .slice(0, 8);

  const expenseByCat = Object.entries(
    (expenses.data ?? []).reduce<Record<string, number>>((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + e.amount;
      return acc;
    }, {})
  );
  const expenseTotal = expenseByCat.reduce((s, [, v]) => s + v, 0);

  // Gold Loan Calculator state.
  const [calcWeight, setCalcWeight] = useState("10");
  const [calcPurity, setCalcPurity] = useState("22K");
  const [calcSchemeId, setCalcSchemeId] = useState<number | undefined>(undefined);
  const activeSchemes = (schemes.data ?? []).filter((s) => s.isActive);
  const effectiveSchemeId = calcSchemeId ?? activeSchemes[0]?.id;
  const purityLabels = (purityStandards.data ?? []).map((p) => p.label);

  const w = parseFloat(calcWeight) || 0;
  const k24 = goldRate.data?.k24 ?? 0;
  const rate = rateForPurityString(k24, calcPurity) ?? 0;
  const selectedScheme = activeSchemes.find((s) => s.id === effectiveSchemeId);
  const gross = w * rate;
  const eligible = selectedScheme ? (gross * selectedScheme.ltvPercent) / 100 : 0;

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ThemedText variant="h2" color={colors.goldDeep}>
          Welcome, {employee?.name}
        </ThemedText>
        <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 16 }}>
          {employee?.role} · {employee?.branch?.name ?? `Branch #${employee?.branchId}`}
        </ThemedText>

        <View style={styles.kpiRow}>
          <Card style={styles.kpi}>
            <ThemedText variant="label" color={colors.muted}>
              24K Gold Rate
            </ThemedText>
            <ThemedText variant="h3" color={colors.goldDeep}>
              {goldRate.isLoading ? "…" : goldRate.data ? `₹${goldRate.data.k24.toLocaleString("en-IN")}` : "—"}
            </ThemedText>
          </Card>
          <Card style={styles.kpi}>
            <ThemedText variant="label" color={colors.muted}>
              Overdue
            </ThemedText>
            <ThemedText variant="h3" color={colors.red}>
              {loans.isLoading ? "…" : overdueCount}
            </ThemedText>
          </Card>
          <Card style={styles.kpi}>
            <ThemedText variant="label" color={colors.muted}>
              Due Today
            </ThemedText>
            <ThemedText variant="h3" color={colors.amber}>
              {events.isLoading ? "…" : dueTodayCount}
            </ThemedText>
          </Card>
        </View>

        <View style={styles.grid}>
          <Card style={styles.tile}>
            <ThemedText variant="label" color={colors.muted}>
              Cash in Hand
            </ThemedText>
            <ThemedText variant="h3" color={colors.green}>
              {cashSummary.isLoading ? "…" : cashSummary.data ? fmt(cashSummary.data.expectedCash) : "—"}
            </ThemedText>
          </Card>
          <Card style={styles.tile}>
            <ThemedText variant="label" color={colors.muted}>
              Loans Opened Today
            </ThemedText>
            <ThemedText variant="h3">{loans.isLoading ? "…" : openedTodayCount}</ThemedText>
          </Card>
          <Card style={styles.tile}>
            <ThemedText variant="label" color={colors.muted}>
              Active Loans
            </ThemedText>
            <ThemedText variant="h3">{loans.isLoading ? "…" : activeCount}</ThemedText>
          </Card>
          <Card style={styles.tile}>
            <ThemedText variant="label" color={colors.muted}>
              Due Soon
            </ThemedText>
            <ThemedText variant="h3" color={dueSoonCount ? colors.amber : colors.ink}>
              {loans.isLoading ? "…" : dueSoonCount}
            </ThemedText>
          </Card>
          <Card style={styles.tile}>
            <ThemedText variant="label" color={colors.muted}>
              Pending Approvals
            </ThemedText>
            <ThemedText variant="h3" color={pendingApprovalLoans.length ? colors.amber : colors.ink}>
              {loans.isLoading ? "…" : pendingApprovalLoans.length}
            </ThemedText>
          </Card>
          <Card style={styles.tile}>
            <ThemedText variant="label" color={colors.muted}>
              Extension Requests
            </ThemedText>
            <ThemedText variant="h3">{requests.isLoading ? "…" : extensionCount}</ThemedText>
            <ThemedText variant="small" color={colors.muted}>
              from mobile app
            </ThemedText>
          </Card>
          <Card style={styles.tile}>
            <ThemedText variant="label" color={colors.muted}>
              Gold Release Requests
            </ThemedText>
            <ThemedText variant="h3">{requests.isLoading ? "…" : releaseCount}</ThemedText>
            <ThemedText variant="small" color={colors.muted}>
              settlement review
            </ThemedText>
          </Card>
          <Card style={styles.tile}>
            <ThemedText variant="label" color={colors.muted}>
              Bank-Pledged Loans
            </ThemedText>
            <ThemedText variant="h3">{loans.isLoading ? "…" : pledgedLoans.length}</ThemedText>
            <ThemedText variant="small" color={colors.muted}>
              {fmt(pledgedLoans.reduce((s, l) => s + l.principalAmount, 0))} re-pledged
            </ThemedText>
          </Card>
          <Card style={styles.tile}>
            <ThemedText variant="label" color={colors.muted}>
              Auction Cases
            </ThemedText>
            <ThemedText variant="h3" color={auctionLoans.length ? colors.red : colors.ink}>
              {loans.isLoading ? "…" : auctionLoans.length}
            </ThemedText>
          </Card>
          <Card style={styles.tile}>
            <ThemedText variant="label" color={colors.muted}>
              Today&apos;s Expenses
            </ThemedText>
            <ThemedText variant="h3">{expenses.isLoading ? "…" : fmt(expToday)}</ThemedText>
            <ThemedText variant="small" color={colors.muted}>
              {expPendingCount} pending approval
            </ThemedText>
          </Card>
        </View>

        <Card style={{ marginTop: 4 }}>
          <ThemedText variant="h3" style={{ marginBottom: 12 }}>
            Loan Portfolio — Disbursement (last 6 months)
          </ThemedText>
          <View style={styles.bars}>
            {monthBuckets.map(([m, v], i) => (
              <View key={m + i} style={styles.barCol}>
                <ThemedText variant="small" color={colors.muted}>
                  {v >= 0.1 ? `₹${v.toFixed(1)}L` : ""}
                </ThemedText>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { height: `${(v / maxBar) * 100}%` }]} />
                </View>
                <ThemedText variant="small" color={colors.muted}>
                  {m}
                </ThemedText>
              </View>
            ))}
          </View>
        </Card>

        <Card>
          <ThemedText variant="h3" style={{ marginBottom: 8 }}>
            Needs Attention
          </ThemedText>
          {pendingApprovalLoans.length + requestList.length + auctionLoans.length === 0 ? (
            <ThemedText variant="small" color={colors.muted}>
              Nothing needs attention right now.
            </ThemedText>
          ) : (
            <>
              {pendingApprovalLoans.map((l) => (
                <Pressable key={`appr-${l.id}`} onPress={() => router.push(`/loans/${l.id}`)}>
                  <View style={styles.attnRow}>
                    <View style={[styles.attnDot, { backgroundColor: colors.amber }]} />
                    <View style={{ flex: 1 }}>
                      <ThemedText variant="body">Loan approval — {l.loanNumber}</ThemedText>
                      <ThemedText variant="small" color={colors.muted}>
                        {l.customer?.name ?? "Customer"} · {fmt(l.principalAmount)} · at {l.approvalStage} stage
                      </ThemedText>
                    </View>
                    <ThemedText variant="small" color={colors.goldDeep}>
                      Review
                    </ThemedText>
                  </View>
                </Pressable>
              ))}
              {requestList.map((r) => (
                <View key={`req-${r.id}`} style={styles.attnRow}>
                  <View style={[styles.attnDot, { backgroundColor: colors.blue }]} />
                  <View style={{ flex: 1 }}>
                    <ThemedText variant="body">
                      {r.type} request — loan #{r.loanId}
                    </ThemedText>
                    <ThemedText variant="small" color={colors.muted}>
                      {r.detail || r.requestedBy}
                    </ThemedText>
                  </View>
                </View>
              ))}
              {auctionLoans.map((l) => (
                <Pressable key={`auc-${l.id}`} onPress={() => router.push(`/loans/${l.id}`)}>
                  <View style={styles.attnRow}>
                    <View style={[styles.attnDot, { backgroundColor: colors.red }]} />
                    <View style={{ flex: 1 }}>
                      <ThemedText variant="body">Auction case — {l.loanNumber}</ThemedText>
                      <ThemedText variant="small" color={colors.muted}>
                        {l.customer?.name ?? "Customer"} · {fmt(l.outstandingAmount)} outstanding · {l.status}
                      </ThemedText>
                    </View>
                    <ThemedText variant="small" color={colors.goldDeep}>
                      Open
                    </ThemedText>
                  </View>
                </Pressable>
              ))}
            </>
          )}
        </Card>

        <Card>
          <ThemedText variant="h3" style={{ marginBottom: 4 }}>
            Gold Loan Calculator
          </ThemedText>
          <GoldTextInput
            label="Weight (grams)"
            keyboardType="numeric"
            value={calcWeight}
            onChangeText={setCalcWeight}
          />
          <ChipSelect
            label="Purity"
            options={purityLabels.length ? purityLabels : ["22K"]}
            value={calcPurity}
            onChange={setCalcPurity}
          />
          <ChipSelect
            label="Scheme"
            options={activeSchemes.map((s) => s.name)}
            value={selectedScheme?.name}
            onChange={(name) => {
              const s = activeSchemes.find((sc) => sc.name === name);
              if (s) setCalcSchemeId(s.id);
            }}
          />
          <View style={styles.calcResult}>
            <View style={styles.calcRow}>
              <ThemedText variant="small">Gross Gold Value</ThemedText>
              <ThemedText variant="small" style={{ fontWeight: "600" }}>
                {fmt(gross)}
              </ThemedText>
            </View>
            <View style={styles.calcRow}>
              <ThemedText variant="body" style={{ fontWeight: "600" }}>
                Eligible Loan Amount
              </ThemedText>
              <ThemedText variant="h3" color={colors.goldDeep}>
                {fmt(eligible)}
              </ThemedText>
            </View>
          </View>
          <ThemedText variant="small" color={colors.muted} style={{ marginTop: 6 }}>
            Weight × Rate = Gross Value · Gross × LTV = Eligible
          </ThemedText>
        </Card>

        <Card>
          <ThemedText variant="h3" style={{ marginBottom: 8 }}>
            Upcoming Reminders
          </ThemedText>
          {upcomingReminders.length ? (
            upcomingReminders.map((e, i) => {
              const tone = statusColors(toneForType(e.type));
              return (
                <View key={i} style={styles.attnRow}>
                  <View style={[styles.attnDot, { backgroundColor: tone.fg }]} />
                  <View style={{ flex: 1 }}>
                    <ThemedText variant="body">{e.title}</ThemedText>
                    <ThemedText variant="small" color={colors.muted}>
                      {e.detail} · {e.date}
                    </ThemedText>
                  </View>
                </View>
              );
            })
          ) : (
            <ThemedText variant="small" color={colors.muted}>
              {events.isLoading ? "Loading…" : "No pending reminders."}
            </ThemedText>
          )}
        </Card>

        <Card>
          <ThemedText variant="h3" style={{ marginBottom: 8 }}>
            Expense Summary
          </ThemedText>
          {expenseByCat.length ? (
            <>
              <View style={styles.stackBar}>
                {expenseByCat.map(([cat, amt], i) => (
                  <View
                    key={cat}
                    style={{
                      flex: amt / (expenseTotal || 1),
                      backgroundColor: EXPENSE_COLORS[i % EXPENSE_COLORS.length],
                    }}
                  />
                ))}
              </View>
              {expenseByCat.map(([cat, amt], i) => (
                <View key={cat} style={styles.legendRow}>
                  <View style={[styles.legendDot, { backgroundColor: EXPENSE_COLORS[i % EXPENSE_COLORS.length] }]} />
                  <ThemedText variant="small" style={{ flex: 1 }}>
                    {cat}
                  </ThemedText>
                  <ThemedText variant="small" color={colors.muted}>
                    {fmt(amt)} · {((amt / (expenseTotal || 1)) * 100).toFixed(0)}%
                  </ThemedText>
                </View>
              ))}
            </>
          ) : (
            <ThemedText variant="small" color={colors.muted}>
              No expenses recorded yet.
            </ThemedText>
          )}
        </Card>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  kpiRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  kpi: { flex: 1, alignItems: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  tile: {
    minWidth: "47%",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 12,
  },
  bars: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", height: 160 },
  barCol: { flex: 1, alignItems: "center" },
  barTrack: {
    width: 18,
    height: 100,
    justifyContent: "flex-end",
    marginVertical: 4,
  },
  barFill: {
    width: "100%",
    backgroundColor: colors.goldMid,
    borderRadius: 4,
    minHeight: 2,
  },
  attnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  attnDot: { width: 8, height: 8, borderRadius: 4 },
  calcResult: {
    backgroundColor: colors.goldPale,
    borderWidth: 1,
    borderColor: colors.goldLight,
    borderRadius: 8,
    padding: 12,
    gap: 6,
  },
  calcRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  stackBar: {
    flexDirection: "row",
    height: 14,
    borderRadius: 7,
    overflow: "hidden",
    marginBottom: 12,
    backgroundColor: colors.line,
  },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
});
