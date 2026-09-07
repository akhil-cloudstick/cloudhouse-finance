import React, { useState } from "react";
import { ScrollView, View, Pressable, StyleSheet, RefreshControl } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../src/components/ScreenContainer";
import { GlassCard } from "../../src/components/GlassCard";
import { ThemedText } from "../../src/components/ThemedText";
import { ChipSelect } from "../../src/components/ChipSelect";
import { GoldTextInput } from "../../src/components/GoldTextInput";
import { colors, statusColors, StatusTone } from "../../src/theme/colors";
import { useAuth } from "../../src/auth/AuthContext";
import { useRefetchOnFocus } from "../../src/hooks/useRefetchOnFocus";
import { latestGoldRate, listGoldRatesPage } from "../../src/api/goldRates";
import { getCalendarEvents } from "../../src/api/reminders";
import { listLoans, listLoanRequests, getInterestCollected } from "../../src/api/loans";
import { listCashMovements, listExpenses } from "../../src/api/cash";
import { listPurityStandards } from "../../src/api/purityStandards";
import { listSchemes } from "../../src/api/schemes";
import { latestDashboardSnapshot } from "../../src/api/dashboard";
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

const EXPENSE_COLORS = [colors.brandDeep, colors.brandMid, colors.info, colors.green, colors.red, colors.amber];

// Small "▲12% / ▼5%" badge comparing a live count/value against a real
// previous-period baseline (yesterday's captured snapshot, or the prior
// published gold rate) — never a fabricated trend. `goodDirection` picks
// which arrow direction reads as green vs red: "up" for metrics where more
// is good (e.g. Gold Rate), "down" for metrics where fewer is good (e.g.
// Overdue). Renders nothing when there's no baseline yet (first day after
// this feature ships, before any snapshot has been captured) or the value
// is unchanged.
function Trend({ current, previous, goodDirection = "up" }: { current: number; previous: number | null | undefined; goodDirection?: "up" | "down" }) {
  if (previous == null || current === previous) return null;
  const up = current > previous;
  const pct = previous !== 0 ? Math.abs(((current - previous) / previous) * 100) : 100;
  const good = up === (goodDirection === "up");
  return (
    <View style={styles.trendRow}>
      <ThemedText variant="small" color={good ? colors.green : colors.red} style={styles.trendText}>
        {up ? "▲" : "▼"} {pct >= 10 ? Math.round(pct) : pct.toFixed(1)}%
      </ThemedText>
      <ThemedText variant="small" color={colors.muted} style={styles.trendText}>
        vs yesterday
      </ThemedText>
    </View>
  );
}

function toneForType(type: CalendarEvent["type"]): StatusTone {
  if (type === "Overdue") return "red";
  if (type === "LoanDue" || type === "InterestDue") return "amber";
  if (type === "PromiseToPay") return "info";
  return "muted";
}

// Every module is reachable from the bottom bar or its More sheet
// (app/(tabs)/_layout.tsx, src/components/AppTabBar.tsx) —
// this screen only shows KPIs/summaries, not a link grid. Ported from
// frontend/components/Dashboard.tsx's "Business Overview" — see that file
// for the reference layout (KPI row, disbursement bars, Needs Attention,
// gold-loan calculator, upcoming reminders, expense summary).
export default function DashboardScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const branchId = employee?.branchId;
  const today = new Date().toISOString().slice(0, 10);

  // Pushing straight to `/loans/[id]` from outside the Loans tab leaves that
  // tab's Stack with the detail screen as its ONLY entry — `unstable_settings
  // .anchor` on loans/_layout.tsx only backfills the list screen for a
  // cold-start deep link, not an in-app push. Pushing the list first builds
  // the history explicitly, so the back chevron and the Loans tab both land
  // on the list instead of Dashboard/detail.
  function openLoan(id: string | number) {
    router.push("/loans");
    router.push(`/loans/${id}`);
  }

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
  // Cash in Hand — mirrors frontend/components/Dashboard.tsx's own KPI
  // exactly: all-time net(cash-in movements − cash-out movements), branch-
  // scoped server-side from the logged-in employee's own branch (backend/
  // internal/cash/handler.go's platform.GetBranchScope), NOT `/cash/summary`
  // .expectedCash — that's a different, date-scoped reconciliation figure
  // from the Cash module's own page (see cash/index.tsx), which requires an
  // opening balance to have been entered for today or silently reads low.
  const cashMovements = useQuery({ queryKey: ["cash", "movements", "all"], queryFn: listCashMovements });
  // Mirrors web Dashboard's own no-args call — server defaults the range to
  // [first-of-current-month, today] (backend/internal/loan/handler.go).
  const interestCollected = useQuery({ queryKey: ["loans", "interest-collected"], queryFn: () => getInterestCollected() });
  // Real vs-yesterday baselines for the trend badges below — a captured
  // KPI-count snapshot (see backend/internal/dashboard/snapshot_model.go)
  // and the previously published gold rate (limit:2 returns [current, prior]
  // when both exist).
  const snapshot = useQuery({ queryKey: ["dashboard", "snapshot", "latest"], queryFn: latestDashboardSnapshot });
  const goldRateHistory = useQuery({
    queryKey: ["gold-rates", "recent", 2],
    queryFn: () => listGoldRatesPage({ limit: 2, offset: 0 }),
  });
  const previousK24 = goldRateHistory.data?.items?.[1]?.k24;

  useRefetchOnFocus(
    goldRate.refetch,
    events.refetch,
    loans.refetch,
    expenses.refetch,
    requests.refetch,
    purityStandards.refetch,
    schemes.refetch,
    cashMovements.refetch,
    interestCollected.refetch,
    snapshot.refetch,
    goldRateHistory.refetch
  );

  const [refreshing, setRefreshing] = useState(false);
  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([
      goldRate.refetch(),
      events.refetch(),
      loans.refetch(),
      expenses.refetch(),
      requests.refetch(),
      purityStandards.refetch(),
      schemes.refetch(),
      cashMovements.refetch(),
      interestCollected.refetch(),
      snapshot.refetch(),
      goldRateHistory.refetch(),
    ]);
    setRefreshing(false);
  }

  const dueTodayCount =
    events.data?.filter((e) => e.type === "LoanDue" && e.date === today).length ?? 0;

  const loanList = loans.data ?? [];
  const activeCount = loanList.filter((l) => ["Active", "Due Soon", "Overdue"].includes(l.status)).length;
  const overdueCount = loanList.filter((l) => l.status === "Overdue").length;
  const pendingApprovalLoans = loanList.filter((l) => l.status === "Pending Approval");
  const auctionLoans = loanList.filter((l) => l.status === "Auction Eligible" || l.status === "Defaulted");
  const openedTodayCount = loanList.filter((l) => l.openedDate === today).length;
  const pledgedLoans = loanList.filter((l) => l.bankPledgeStatus === "Bank Pledged");

  const requestList = requests.data ?? [];
  const extensionCount = requestList.filter((r) => r.type === "Extension").length;
  const releaseCount = requestList.filter((r) => r.type === "Release").length;

  // Mirrors frontend/components/Dashboard.tsx's own "Cash in Hand" KPI —
  // all-time net(cash-in − cash-out) movements, branch-scoped server-side.
  // See cashMovements query's own comment above for why this is NOT
  // `/cash/summary`.expectedCash.
  const movementList = cashMovements.data ?? [];
  const cashInHand =
    movementList.filter((m) => m.type === "in").reduce((s, m) => s + m.amount, 0) -
    movementList.filter((m) => m.type === "out").reduce((s, m) => s + m.amount, 0);

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
    <ScreenContainer style={{ padding: 0 }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 8, paddingTop: 20, paddingBottom: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <ThemedText variant="h2" color={colors.brandDeep}>
          Welcome, {employee?.name}
        </ThemedText>
        <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 16 }}>
          {employee?.role} · {employee?.branch?.name ?? `Branch #${employee?.branchId}`}
        </ThemedText>

        {/* One continuous 2-up grid, top KPIs included — used to be a
            separate 3-across row above this grid, but that broke the
            strict 2-column layout everything else follows. */}
        <View style={styles.grid}>
          <GlassCard style={styles.tile}>
            <ThemedText variant="label" color={colors.muted}>
              Loans Opened Today
            </ThemedText>
            <ThemedText variant="h3">{loans.isLoading ? "…" : openedTodayCount}</ThemedText>
            <Trend current={openedTodayCount} previous={snapshot.data?.openedTodayCount} goodDirection="up" />
          </GlassCard>
          <GlassCard style={styles.tile}>
            <ThemedText variant="label" color={colors.muted}>
              Overdue
            </ThemedText>
            <ThemedText variant="h3" color={colors.red}>
              {loans.isLoading ? "…" : overdueCount}
            </ThemedText>
            <Trend current={overdueCount} previous={snapshot.data?.overdueCount} goodDirection="down" />
          </GlassCard>
          <GlassCard style={styles.tile}>
            <ThemedText variant="label" color={colors.muted}>
              Due Today
            </ThemedText>
            <ThemedText variant="h3" color={colors.amber}>
              {events.isLoading ? "…" : dueTodayCount}
            </ThemedText>
            <Trend current={dueTodayCount} previous={snapshot.data?.dueTodayCount} goodDirection="down" />
          </GlassCard>
          <GlassCard style={styles.tile}>
            <ThemedText variant="label" color={colors.muted}>
              24K Gold Rate
            </ThemedText>
            <ThemedText variant="h3" color={colors.brandDeep}>
              {goldRate.isLoading ? "…" : goldRate.data ? `₹${goldRate.data.k24.toLocaleString("en-IN")}` : "—"}
            </ThemedText>
            {goldRate.data ? <Trend current={goldRate.data.k24} previous={previousK24} goodDirection="up" /> : null}
          </GlassCard>
          <GlassCard style={styles.tile}>
            <ThemedText variant="label" color={colors.muted}>
              Cash in Hand
            </ThemedText>
            <ThemedText variant="h3" color={colors.green}>
              {cashMovements.isLoading ? "…" : fmt(cashInHand)}
            </ThemedText>
            <ThemedText variant="small" color={colors.muted}>
              across {movementList.length} movements
            </ThemedText>
          </GlassCard>
          <GlassCard style={styles.tile}>
            <ThemedText variant="label" color={colors.muted}>
              Interest Collected
            </ThemedText>
            <ThemedText variant="h3" color={colors.green}>
              {interestCollected.isLoading ? "…" : interestCollected.data ? fmt(interestCollected.data.interestCollected) : "—"}
            </ThemedText>
            <ThemedText variant="small" color={colors.muted}>
              this month
            </ThemedText>
          </GlassCard>
          <GlassCard style={styles.tile}>
            <ThemedText variant="label" color={colors.muted}>
              Active Loans
            </ThemedText>
            <ThemedText variant="h3">{loans.isLoading ? "…" : activeCount}</ThemedText>
            <Trend current={activeCount} previous={snapshot.data?.activeCount} goodDirection="up" />
          </GlassCard>
          <GlassCard style={styles.tile}>
            <ThemedText variant="label" color={colors.muted}>
              Loan Opened Today
            </ThemedText>
            <ThemedText variant="h3">{loans.isLoading ? "…" : openedTodayCount}</ThemedText>
            <Trend current={openedTodayCount} previous={snapshot.data?.openedTodayCount} goodDirection="up" />
          </GlassCard>
          <GlassCard style={styles.tile}>
            <ThemedText variant="label" color={colors.muted}>
              Pending Approvals
            </ThemedText>
            <ThemedText variant="h3" color={pendingApprovalLoans.length ? colors.amber : colors.ink}>
              {loans.isLoading ? "…" : pendingApprovalLoans.length}
            </ThemedText>
            <Trend current={pendingApprovalLoans.length} previous={snapshot.data?.pendingApprovalCount} goodDirection="down" />
          </GlassCard>
          <GlassCard style={styles.tile}>
            <ThemedText variant="label" color={colors.muted}>
              Extension Requests
            </ThemedText>
            <ThemedText variant="h3">{requests.isLoading ? "…" : extensionCount}</ThemedText>
            <ThemedText variant="small" color={colors.muted}>
              from mobile app
            </ThemedText>
          </GlassCard>
          <GlassCard style={styles.tile}>
            <ThemedText variant="label" color={colors.muted}>
              Gold Release Requests
            </ThemedText>
            <ThemedText variant="h3">{requests.isLoading ? "…" : releaseCount}</ThemedText>
            <ThemedText variant="small" color={colors.muted}>
              settlement review
            </ThemedText>
          </GlassCard>
          <GlassCard style={styles.tile}>
            <ThemedText variant="label" color={colors.muted}>
              Bank-Pledged Loans
            </ThemedText>
            <ThemedText variant="h3">{loans.isLoading ? "…" : pledgedLoans.length}</ThemedText>
            <ThemedText variant="small" color={colors.muted}>
              {fmt(pledgedLoans.reduce((s, l) => s + l.principalAmount, 0))} re-pledged
            </ThemedText>
          </GlassCard>
          <GlassCard style={styles.tile}>
            <ThemedText variant="label" color={colors.muted}>
              Auction Cases
            </ThemedText>
            <ThemedText variant="h3" color={auctionLoans.length ? colors.red : colors.ink}>
              {loans.isLoading ? "…" : auctionLoans.length}
            </ThemedText>
            <ThemedText variant="small" color={colors.muted}>
              {fmt(auctionLoans.reduce((s, l) => s + l.outstandingAmount, 0))} outstanding
            </ThemedText>
          </GlassCard>
          <GlassCard style={styles.tile}>
            <ThemedText variant="label" color={colors.muted}>
              Today&apos;s Expenses
            </ThemedText>
            <ThemedText variant="h3">{expenses.isLoading ? "…" : fmt(expToday)}</ThemedText>
            <ThemedText variant="small" color={colors.muted}>
              {expPendingCount} pending approval
            </ThemedText>
          </GlassCard>
        </View>

        <GlassCard style={{ marginTop: 4 }}>
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
        </GlassCard>

        <GlassCard>
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
                <Pressable key={`appr-${l.id}`} onPress={() => openLoan(l.id)}>
                  <View style={styles.attnRow}>
                    <View style={[styles.attnDot, { backgroundColor: colors.amber }]} />
                    <View style={{ flex: 1 }}>
                      <ThemedText variant="body">Loan approval — {l.loanNumber}</ThemedText>
                      <ThemedText variant="small" color={colors.muted}>
                        {l.customer?.name ?? "Customer"} · {fmt(l.principalAmount)} · at {l.approvalStage} stage
                      </ThemedText>
                    </View>
                    <ThemedText variant="small" color={colors.brandDeep}>
                      Review
                    </ThemedText>
                  </View>
                </Pressable>
              ))}
              {requestList.map((r) => (
                <View key={`req-${r.id}`} style={styles.attnRow}>
                  <View style={[styles.attnDot, { backgroundColor: colors.info }]} />
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
                <Pressable key={`auc-${l.id}`} onPress={() => openLoan(l.id)}>
                  <View style={styles.attnRow}>
                    <View style={[styles.attnDot, { backgroundColor: colors.red }]} />
                    <View style={{ flex: 1 }}>
                      <ThemedText variant="body">Auction case — {l.loanNumber}</ThemedText>
                      <ThemedText variant="small" color={colors.muted}>
                        {l.customer?.name ?? "Customer"} · {fmt(l.outstandingAmount)} outstanding · {l.status}
                      </ThemedText>
                    </View>
                    <ThemedText variant="small" color={colors.brandDeep}>
                      Open
                    </ThemedText>
                  </View>
                </Pressable>
              ))}
            </>
          )}
        </GlassCard>

        <GlassCard>
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
              <ThemedText variant="h3" color={colors.brandDeep}>
                {fmt(eligible)}
              </ThemedText>
            </View>
          </View>
          <ThemedText variant="small" color={colors.muted} style={{ marginTop: 6 }}>
            Weight × Rate = Gross Value · Gross × LTV = Eligible
          </ThemedText>
        </GlassCard>

        <GlassCard>
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
        </GlassCard>

        <GlassCard>
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
        </GlassCard>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  trendRow: { flexDirection: "row", gap: 4, marginTop: 2 },
  trendText: { fontSize: 11 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  // Background/border/radius deliberately omitted — GlassCard's own base
  // style supplies those (the frosted fill, soft border, rounded corners);
  // setting them here would paint over the glass effect and defeat it.
  // width (not minWidth) pins this to a strict 2-up grid — every tile takes
  // exactly half the row regardless of its own content length, so an odd
  // tile count still lines up instead of one long label pushing a 3rd
  // column onto some rows and 2 onto others.
  tile: {
    width: "48%",
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
    backgroundColor: colors.brandMid,
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
    backgroundColor: colors.brandPale,
    borderWidth: 1,
    borderColor: colors.brandLight,
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
