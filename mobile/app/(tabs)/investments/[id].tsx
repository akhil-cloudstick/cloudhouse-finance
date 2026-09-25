import React, { useState } from "react";
import { View, RefreshControl, Alert } from "react-native";
import { GutterScrollView } from "../../../src/components/Gutter";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { ChipSelect } from "../../../src/components/ChipSelect";
import { Loading } from "../../../src/components/Loading";
import { colors, statusColors } from "../../../src/theme/colors";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { fmt } from "../../../src/lib/format";
import { useAuth } from "../../../src/auth/AuthContext";
import { useRefetchOnFocus, useResetOnBlur } from "../../../src/hooks/useRefetchOnFocus";
import { ApiError } from "../../../src/api/client";
import {
  getInvestment,
  getInvestmentSchedulePage,
  getInvestmentTransactionsPage,
  addCashToInvestment,
  withdrawFromInvestment,
  matureInvestment,
  markPayoutPaid,
  splitForMode,
  listInvestmentPlans,
  PaymentMode,
} from "../../../src/api/investments";
import { InvestmentStatus } from "../../../src/types/investment";
import { downloadInvestmentBondPdf, previewInvestmentBondPdf } from "../../../src/utils/investmentBond";

const PAYMENT_MODES = ["Cash", "UPI", "Bank Transfer", "Cheque"] as const;
const WITHDRAW_FROM = ["Interest", "Principal", "Both"] as const;

const SUB_PAGE_SIZE = 10;

function toneForInvestmentStatus(status: InvestmentStatus): "green" | "red" | "amber" | "info" | "muted" {
  if (status === "Active") return "green";
  if (status === "Closed") return "muted";
  if (status === "Renewed") return "amber";
  return "info";
}

function StatusPill({ label, tone }: { label: string; tone: "green" | "red" | "amber" | "info" | "muted" }) {
  const { colors } = useTheme();
  const t = statusColors(tone, colors);
  return (
    <ThemedText
      variant="small"
      style={{ backgroundColor: t.bg, color: t.fg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, alignSelf: "flex-start" }}
    >
      {label}
    </ThemedText>
  );
}

// Click-paginated (10/page) sub-table — same convention as personal-loans/
// [id].tsx's usePagedSubTable.
function usePagedSubTable<T>(queryKeyPrefix: string, id: number, fetchPage: (limit: number, offset: number) => Promise<{ items: T[]; hasMore: boolean }>) {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: [queryKeyPrefix, id, page],
    queryFn: () => fetchPage(SUB_PAGE_SIZE, (page - 1) * SUB_PAGE_SIZE),
    enabled: !!id,
  });
  const totalPages = q.data?.hasMore ? page + 1 : page;
  return { items: q.data?.items ?? [], page, setPage, totalPages, isLoading: q.isLoading, isError: q.isError, refetch: q.refetch };
}

function Pager({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14, paddingTop: 10 }}>
      <GoldButton title="‹ Prev" variant="outline" onPress={() => onChange(Math.max(1, page - 1))} disabled={page <= 1} style={{ height: 34, paddingHorizontal: 14 }} />
      <ThemedText variant="small" color={colors.muted}>
        Page {page} of {totalPages}
      </ThemedText>
      <GoldButton title="Next ›" variant="outline" onPress={() => onChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages} style={{ height: 34, paddingHorizontal: 14 }} />
    </View>
  );
}

export default function InvestmentDetailScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const investmentId = Number(id);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canUpdate = can("Investment_Management", "can_update_investment");

  const investment = useQuery({ queryKey: ["investment", id], queryFn: () => getInvestment(investmentId), enabled: !!id });
  useRefetchOnFocus(investment.refetch);

  const isLive = investment.data?.engine === "Live";

  const [action, setAction] = useState<"addCash" | "withdraw" | "mature" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [downloadingBond, setDownloadingBond] = useState(false);
  const [printingBond, setPrintingBond] = useState(false);
  async function handleDownloadBond() {
    if (!investment.data) return;
    setDownloadingBond(true);
    try {
      await downloadInvestmentBondPdf(investment.data.id, investment.data.investmentNumber);
    } catch (e) {
      Alert.alert("Download failed", e instanceof Error ? e.message : "Could not download the agreement.");
    } finally {
      setDownloadingBond(false);
    }
  }
  async function handlePrintBond() {
    if (!investment.data) return;
    setPrintingBond(true);
    try {
      await previewInvestmentBondPdf(investment.data.id, investment.data.investmentNumber);
    } catch (e) {
      Alert.alert("Preview failed", e instanceof Error ? e.message : "Could not open the agreement.");
    } finally {
      setPrintingBond(false);
    }
  }

  // Add Cash
  const [acAmount, setAcAmount] = useState("");
  const [acMode, setAcMode] = useState<PaymentMode>("Cash");
  const [acReference, setAcReference] = useState("");

  // Withdraw
  const [wFrom, setWFrom] = useState<(typeof WITHDRAW_FROM)[number]>("Interest");
  const [wInterest, setWInterest] = useState("");
  const [wPrincipal, setWPrincipal] = useState("");
  const [wMode, setWMode] = useState<PaymentMode>("Cash");
  const [wReference, setWReference] = useState("");

  // Close/Renew (maturity)
  const [matureAction, setMatureAction] = useState<"Close" | "Renew">("Close");
  const plans = useQuery({
    queryKey: ["investmentPlans", "active"],
    queryFn: () => listInvestmentPlans(true),
    enabled: action === "mature" && matureAction === "Renew",
  });
  const [renewPlanId, setRenewPlanId] = useState<number | null>(null);
  const [renewPrincipal, setRenewPrincipal] = useState("");

  function closeForm() {
    setAction(null);
    setError(null);
  }

  function invalidateInvestment() {
    queryClient.invalidateQueries({ queryKey: ["investment", id] });
    queryClient.invalidateQueries({ queryKey: ["investmentTransactions", investmentId] });
    queryClient.invalidateQueries({ queryKey: ["investmentSchedule", investmentId] });
    queryClient.invalidateQueries({ queryKey: ["investments"] });
  }

  const addCash = useMutation({
    mutationFn: () =>
      addCashToInvestment(investmentId, {
        amount: Number(acAmount),
        reference: acReference.trim() || undefined,
        ...splitForMode(acMode, Number(acAmount)),
      }),
    onSuccess: () => {
      setAcAmount(""); setAcReference("");
      closeForm();
      invalidateInvestment();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not add cash — try again."),
  });

  const withdraw = useMutation({
    mutationFn: () => {
      const interestAmount = wFrom === "Principal" ? 0 : Number(wInterest || 0);
      const principalAmount = wFrom === "Interest" ? 0 : Number(wPrincipal || 0);
      const total = interestAmount + principalAmount;
      return withdrawFromInvestment(investmentId, {
        interestAmount,
        principalAmount,
        reference: wReference.trim() || undefined,
        ...splitForMode(wMode, total),
      });
    },
    onSuccess: () => {
      setWInterest(""); setWPrincipal(""); setWReference("");
      closeForm();
      invalidateInvestment();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not withdraw — try again."),
  });

  const mature = useMutation({
    mutationFn: () =>
      matureInvestment(investmentId, {
        action: matureAction,
        planId: matureAction === "Renew" ? renewPlanId ?? undefined : undefined,
        principalAmount: matureAction === "Renew" ? Number(renewPrincipal || 0) : undefined,
      }),
    onSuccess: () => {
      setRenewPlanId(null); setRenewPrincipal("");
      closeForm();
      invalidateInvestment();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not apply the maturity decision — try again."),
  });

  const [markingPayoutId, setMarkingPayoutId] = useState<number | null>(null);
  const markPaid = useMutation({
    mutationFn: ({ payoutId, amount, mode }: { payoutId: number; amount: number; mode: PaymentMode }) =>
      markPayoutPaid(investmentId, payoutId, splitForMode(mode, amount)),
    onSuccess: () => {
      setMarkingPayoutId(null);
      invalidateInvestment();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not mark the payout paid — try again."),
  });

  useResetOnBlur(() => {
    setAction(null);
    setMarkingPayoutId(null);
  });

  const transactions = usePagedSubTable(
    "investmentTransactions",
    investmentId,
    (limit, offset) => getInvestmentTransactionsPage(investmentId, limit, offset)
  );
  const schedule = usePagedSubTable(
    "investmentSchedule",
    investmentId,
    (limit, offset) => getInvestmentSchedulePage(investmentId, limit, offset)
  );

  if (investment.isLoading) {
    return (
      <ScreenContainer style={{ padding: 0 }}>
        <View style={{ flex: 1, paddingHorizontal: 8, paddingTop: 20 }}>
          <Loading full />
        </View>
      </ScreenContainer>
    );
  }
  if (investment.isError || !investment.data) {
    return (
      <ScreenContainer style={{ padding: 0 }}>
        <View style={{ flex: 1, paddingHorizontal: 8, paddingTop: 20 }}>
          <ThemedText color={colors.red}>Could not load this investment.</ThemedText>
        </View>
      </ScreenContainer>
    );
  }

  const inv = investment.data;

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <View style={{ flex: 1, paddingHorizontal: 8, paddingTop: 20 }}>
        <GutterScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={investment.isRefetching} onRefresh={() => investment.refetch()} />}
        >
          <Card>
            <ThemedText variant="h2" color={colors.brandDeep}>
              {inv.investmentNumber}
            </ThemedText>
            <ThemedText variant="body" style={{ marginTop: 8 }}>
              {inv.customer?.name ?? `Customer #${inv.customerId}`}
            </ThemedText>
            <View style={{ marginTop: 10 }}>
              <StatusPill label={inv.status} tone={toneForInvestmentStatus(inv.status)} />
            </View>

            {inv.plan?.productType === "Bond" ? (
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                <View style={{ flex: 1 }}>
                  <GoldButton title="Print Agreement" variant="outline" onPress={handlePrintBond} loading={printingBond} />
                </View>
                <View style={{ flex: 1 }}>
                  <GoldButton title="Download Agreement" variant="outline" onPress={handleDownloadBond} loading={downloadingBond} />
                </View>
              </View>
            ) : null}

            <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 12, marginHorizontal: -6 }}>
              {[
                ["Principal", fmt(inv.principalAmount)],
                ["Interest Rate", `${inv.interestRatePercent}% (${inv.interestRateType})`],
                [isLive ? "Outstanding Interest" : "Interest Paid", fmt(isLive ? inv.outstandingInterest : inv.totalInterestPaid)],
                ["Maturity Date", new Date(inv.maturityDate).toLocaleDateString("en-IN")],
                ["Tenure", `${inv.tenureMonths} months`],
                ["Payout", inv.payoutFrequency],
              ].map(([label, value]) => (
                <View key={label} style={{ width: "50%", paddingHorizontal: 6, marginBottom: 10 }}>
                  <ThemedText variant="small" color={colors.muted}>
                    {label}
                  </ThemedText>
                  <ThemedText variant="body">{value}</ThemedText>
                </View>
              ))}
            </View>

            {inv.renewedFromInvestmentId ? (
              <ThemedText variant="small" color={colors.info} style={{ marginTop: 4 }}>
                Renewed from Investment #{inv.renewedFromInvestmentId}
              </ThemedText>
            ) : null}
            {inv.renewedToInvestmentId ? (
              <ThemedText variant="small" color={colors.info} style={{ marginTop: 4 }}>
                Renewed to Investment #{inv.renewedToInvestmentId}
              </ThemedText>
            ) : null}
            {canUpdate && inv.status === "Active" ? (
              <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
                {isLive ? (
                  <>
                    <View style={{ flex: 1 }}>
                      <GoldButton title="Add Cash" onPress={() => { setAction((a) => (a === "addCash" ? null : "addCash")); setError(null); }} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <GoldButton title="Withdraw" variant="outline" onPress={() => { setAction((a) => (a === "withdraw" ? null : "withdraw")); setError(null); }} />
                    </View>
                  </>
                ) : null}
              </View>
            ) : null}
            {canUpdate && inv.status === "Matured" ? (
              <View style={{ marginTop: 14 }}>
                <GoldButton title="Close / Renew" onPress={() => { setAction((a) => (a === "mature" ? null : "mature")); setError(null); }} />
              </View>
            ) : null}
          </Card>

          {error ? (
            <Card>
              <ThemedText variant="small" color={colors.red}>{error}</ThemedText>
            </Card>
          ) : null}

          {action === "addCash" ? (
            <Card>
              <ThemedText variant="h3" style={{ marginBottom: 8 }}>Add Cash</ThemedText>
              <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 10 }}>
                Current Outstanding Principal: {fmt(inv.outstandingPrincipal)}
              </ThemedText>
              <GoldTextInput label="Amount (₹)" keyboardType="numeric" value={acAmount} onChangeText={setAcAmount} />
              <ChipSelect label="Mode" options={PAYMENT_MODES} value={acMode} onChange={setAcMode} />
              <GoldTextInput label="Reference (optional)" value={acReference} onChangeText={setAcReference} />
              <GoldButton title="Save" onPress={() => addCash.mutate()} loading={addCash.isPending} disabled={!acAmount || Number(acAmount) <= 0} />
            </Card>
          ) : null}

          {action === "withdraw" ? (
            <Card>
              <ThemedText variant="h3" style={{ marginBottom: 8 }}>Withdraw</ThemedText>
              <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 10 }}>
                Outstanding Principal: {fmt(inv.outstandingPrincipal)} · Outstanding Interest: {fmt(inv.outstandingInterest)}
              </ThemedText>
              <ChipSelect label="Withdraw From" options={WITHDRAW_FROM} value={wFrom} onChange={setWFrom} />
              {wFrom !== "Principal" ? (
                <GoldTextInput label="Interest Amount (₹)" keyboardType="numeric" value={wInterest} onChangeText={setWInterest} />
              ) : null}
              {wFrom !== "Interest" ? (
                <GoldTextInput label="Principal Amount (₹)" keyboardType="numeric" value={wPrincipal} onChangeText={setWPrincipal} />
              ) : null}
              <ChipSelect label="Mode" options={PAYMENT_MODES} value={wMode} onChange={setWMode} />
              <GoldTextInput label="Reference (optional)" value={wReference} onChangeText={setWReference} />
              <GoldButton
                title="Save"
                onPress={() => withdraw.mutate()}
                loading={withdraw.isPending}
                disabled={(Number(wInterest || 0) + Number(wPrincipal || 0)) <= 0}
              />
            </Card>
          ) : null}

          {action === "mature" ? (
            <Card>
              <ThemedText variant="h3" style={{ marginBottom: 8 }}>Close / Renew</ThemedText>
              <ChipSelect label="Action" options={["Close", "Renew"] as const} value={matureAction} onChange={setMatureAction} />
              {matureAction === "Renew" ? (
                <>
                  <ThemedText variant="label" color={colors.muted} style={{ marginBottom: 6 }}>Renew Into Plan</ThemedText>
                  {(plans.data ?? []).map((p) => {
                    const active = p.id === renewPlanId;
                    return (
                      <GoldButton
                        key={p.id}
                        title={`${p.name} — ${p.interestRatePercent}% ${p.payoutFrequency}, ${p.tenureMonths}mo`}
                        variant={active ? "primary" : "outline"}
                        onPress={() => setRenewPlanId(p.id)}
                        style={{ marginBottom: 8 }}
                      />
                    );
                  })}
                  <GoldTextInput label="New Principal Amount (₹)" keyboardType="numeric" value={renewPrincipal} onChangeText={setRenewPrincipal} />
                </>
              ) : null}
              <GoldButton
                title="Confirm"
                onPress={() => mature.mutate()}
                loading={mature.isPending}
                disabled={matureAction === "Renew" && (!renewPlanId || !renewPrincipal)}
              />
            </Card>
          ) : null}

          {isLive ? (
            <Card>
              <ThemedText variant="h3" style={{ marginBottom: 8 }}>
                Transactions
              </ThemedText>
              {transactions.isError ? (
                <ThemedText variant="small" color={colors.red}>Could not load transactions.</ThemedText>
              ) : transactions.isLoading ? (
                <Loading />
              ) : transactions.items.length === 0 ? (
                <ThemedText variant="small" color={colors.muted}>No transactions yet.</ThemedText>
              ) : (
                transactions.items.map((t) => (
                  <View key={t.id} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <ThemedText variant="small">{t.type} · {new Date(t.occurredOn).toLocaleDateString("en-IN")}</ThemedText>
                      <ThemedText variant="small">{fmt(t.amount)}</ThemedText>
                    </View>
                    <ThemedText variant="small" color={colors.muted}>
                      Principal after: {fmt(t.principalAfter)} · Interest after: {fmt(t.interestAfter)}
                    </ThemedText>
                  </View>
                ))
              )}
              <Pager page={transactions.page} totalPages={transactions.totalPages} onChange={transactions.setPage} />
            </Card>
          ) : (
            <Card>
              <ThemedText variant="h3" style={{ marginBottom: 8 }}>
                Interest Payout Schedule
              </ThemedText>
              {schedule.isError ? (
                <ThemedText variant="small" color={colors.red}>Could not load the schedule.</ThemedText>
              ) : schedule.isLoading ? (
                <Loading />
              ) : schedule.items.length === 0 ? (
                <ThemedText variant="small" color={colors.muted}>No payouts scheduled.</ThemedText>
              ) : (
                schedule.items.map((p) => (
                  <View key={p.id} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line }}>
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <ThemedText variant="small" style={{ width: 28 }}>#{p.sequenceNo}</ThemedText>
                      <ThemedText variant="small" style={{ flex: 1 }}>{p.dueDate.slice(0, 10)}</ThemedText>
                      <ThemedText variant="small" style={{ width: 90, textAlign: "right" }}>{fmt(p.amount)}</ThemedText>
                      <View style={{ width: 96, alignItems: "flex-end" }}>
                        <StatusPill label={p.status} tone={p.status === "Paid" ? "green" : "amber"} />
                      </View>
                    </View>
                    {canUpdate && p.status === "Pending" ? (
                      <View style={{ marginTop: 6 }}>
                        {markingPayoutId === p.id ? (
                          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                            {PAYMENT_MODES.map((mode) => (
                              <GoldButton
                                key={mode}
                                title={mode}
                                variant="outline"
                                onPress={() => markPaid.mutate({ payoutId: p.id, amount: p.amount, mode })}
                                loading={markPaid.isPending}
                                style={{ height: 30, paddingHorizontal: 10 }}
                              />
                            ))}
                          </View>
                        ) : (
                          <GoldButton
                            title="Mark Paid"
                            variant="outline"
                            onPress={() => setMarkingPayoutId(p.id)}
                            style={{ height: 30, alignSelf: "flex-start", paddingHorizontal: 12 }}
                          />
                        )}
                      </View>
                    ) : null}
                  </View>
                ))
              )}
              <Pager page={schedule.page} totalPages={schedule.totalPages} onChange={schedule.setPage} />
            </Card>
          )}
        </GutterScrollView>
      </View>
    </ScreenContainer>
  );
}
