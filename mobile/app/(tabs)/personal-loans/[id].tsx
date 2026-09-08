import React, { useState } from "react";
import { ScrollView, View, RefreshControl } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { ChipSelect } from "../../../src/components/ChipSelect";
import { colors, statusColors } from "../../../src/theme/colors";
import { useAuth } from "../../../src/auth/AuthContext";
import { fmt } from "../../../src/lib/format";
import { API_BASE_URL } from "../../../src/api/config";
import { getToken } from "../../../src/auth/tokenStorage";
import { ApiError } from "../../../src/api/client";
import {
  getPersonalLoan,
  getPersonalLoanSchedulePage,
  listPersonalLoanPaymentsPage,
  recordPersonalLoanPayment,
  previewRenewal,
  renewPersonalLoan,
  InterestType,
  Frequency,
} from "../../../src/api/personalLoans";

const SUB_PAGE_SIZE = 10;

const PAYMENT_METHODS = ["Cash", "UPI", "Bank Transfer"] as const;

function toneForStatus(status: string): "green" | "red" | "amber" | "blue" | "muted" {
  const s = status.toLowerCase();
  if (s === "active" || s === "paid") return "green";
  if (s === "defaulted") return "red";
  if (s === "renewed" || s === "partiallypaid" || s === "partially paid") return "amber";
  return "blue";
}

function StatusPill({ status }: { status: string }) {
  const tone = statusColors(toneForStatus(status));
  return (
    <ThemedText
      variant="small"
      style={{ backgroundColor: tone.bg, color: tone.fg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, alignSelf: "flex-start" }}
    >
      {status}
    </ThemedText>
  );
}

// Click-paginated (10/page) sub-table — mirrors the web detail page's own
// usePagedTable, in this app's react-query-driven convention instead of a
// bare useState/useEffect fetch.
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

export default function PersonalLoanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const loanId = Number(id);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canUpdate = can("Personal_Loan_Management", "can_update_personal_loan");

  const loan = useQuery({ queryKey: ["personalLoan", id], queryFn: () => getPersonalLoan(loanId), enabled: !!id });
  useRefetchOnFocus(loan.refetch);

  const schedule = usePagedSubTable("personalLoanSchedule", loanId, (limit, offset) => getPersonalLoanSchedulePage(loanId, limit, offset));
  const payments = usePagedSubTable("personalLoanPayments", loanId, (limit, offset) => listPersonalLoanPaymentsPage(loanId, limit, offset));

  const [error, setError] = useState<string | null>(null);

  // --- Collect payment ---
  const [collectAmount, setCollectAmount] = useState("");
  const [collectMethod, setCollectMethod] = useState<(typeof PAYMENT_METHODS)[number]>("Cash");
  const [collectReference, setCollectReference] = useState("");
  const [collectDescription, setCollectDescription] = useState("");

  function invalidateAfterPayment() {
    queryClient.invalidateQueries({ queryKey: ["personalLoan", id] });
    queryClient.invalidateQueries({ queryKey: ["personalLoanSchedule", loanId] });
    queryClient.invalidateQueries({ queryKey: ["personalLoanPayments", loanId] });
  }

  const collect = useMutation({
    mutationFn: () =>
      recordPersonalLoanPayment(loanId, {
        amount: Number(collectAmount),
        method: collectMethod,
        reference: collectReference || undefined,
        description: collectDescription || undefined,
      }),
    onSuccess: () => {
      setCollectAmount("");
      setCollectReference("");
      setCollectDescription("");
      setError(null);
      invalidateAfterPayment();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not record the payment — try again."),
  });

  // --- Renew ---
  const [renewOpen, setRenewOpen] = useState(false);
  const [renewPrincipal, setRenewPrincipal] = useState("");
  const [renewInterestType, setRenewInterestType] = useState<InterestType>("Flat");
  const [renewInterestValue, setRenewInterestValue] = useState("");
  const [renewFrequency, setRenewFrequency] = useState<Frequency>("Daily");
  const [renewTenure, setRenewTenure] = useState("");

  function openRenew() {
    if (!loan.data) return;
    setRenewPrincipal(String(loan.data.principalAmount));
    setRenewInterestType(loan.data.interestType);
    setRenewInterestValue(String(loan.data.interestValue));
    setRenewFrequency(loan.data.frequency);
    setRenewTenure(String(loan.data.tenureCount));
    setRenewOpen(true);
  }

  const renewPrincipalNum = +renewPrincipal || 0;
  const renewInterestValueNum = +renewInterestValue || 0;
  const renewTenureNum = +renewTenure || 0;

  const renewPreview = useQuery({
    queryKey: ["personalLoanRenewPreview", loanId, renewPrincipalNum, renewInterestType, renewInterestValueNum, renewFrequency, renewTenureNum],
    queryFn: () =>
      previewRenewal(loanId, {
        principalAmount: renewPrincipalNum,
        interestType: renewInterestType,
        interestValue: renewInterestValueNum,
        frequency: renewFrequency,
        tenureCount: renewTenureNum || 1,
      }),
    enabled: renewOpen && renewPrincipalNum > 0,
  });

  const renew = useMutation({
    mutationFn: () =>
      renewPersonalLoan(loanId, {
        principalAmount: renewPrincipalNum,
        interestType: renewInterestType,
        interestValue: renewInterestValueNum,
        frequency: renewFrequency,
        tenureCount: renewTenureNum,
      }),
    onSuccess: (result) => {
      setRenewOpen(false);
      router.replace(`/personal-loans/${result.newLoan.id}`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not renew the loan — try again."),
  });

  // --- Bond download ---
  const [downloadingBond, setDownloadingBond] = useState(false);
  async function downloadBond() {
    if (!loan.data || downloadingBond) return;
    setDownloadingBond(true);
    setError(null);
    try {
      const token = await getToken();
      const targetUri = `${FileSystem.cacheDirectory}bond-${loan.data.loanNumber}.pdf`;
      const result = await FileSystem.downloadAsync(`${API_BASE_URL}/personal-loans/${loanId}/bond`, targetUri, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`Could not download the bond (${result.status}).`);
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri, { mimeType: "application/pdf" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not download the bond.");
    } finally {
      setDownloadingBond(false);
    }
  }

  if (loan.isLoading) {
    return (
      <ScreenContainer style={{ padding: 0 }}>
        <View style={{ flex: 1, paddingHorizontal: 8, paddingTop: 20 }}>
          <ThemedText color={colors.muted}>Loading…</ThemedText>
        </View>
      </ScreenContainer>
    );
  }
  if (loan.isError || !loan.data) {
    return (
      <ScreenContainer style={{ padding: 0 }}>
        <View style={{ flex: 1, paddingHorizontal: 8, paddingTop: 20 }}>
          <ThemedText color={colors.red}>Could not load this loan.</ThemedText>
        </View>
      </ScreenContainer>
    );
  }

  const l = loan.data;

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <View style={{ flex: 1, paddingHorizontal: 8, paddingTop: 20 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={loan.isRefetching} onRefresh={() => loan.refetch()} />}
        >
          <Card>
            <ThemedText variant="h2" color={colors.goldDeep}>
              {l.loanNumber}
            </ThemedText>
            <ThemedText variant="body" style={{ marginTop: 8 }}>
              {l.customer?.name ?? `Customer #${l.customerId}`}
            </ThemedText>
            <View style={{ marginTop: 10 }}>
              <StatusPill status={l.status} />
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 12, marginHorizontal: -6 }}>
              {[
                ["Principal", fmt(l.principalAmount)],
                ["Interest", `${fmt(l.interestAmount)} (${l.interestType === "Flat" ? "Flat" : `${l.interestValue}%`})`],
                ["Disbursed", fmt(l.disbursedAmount)],
                ["Outstanding", fmt(l.outstandingAmount)],
                ["Frequency", l.frequency],
                ["Total Paid", fmt(l.totalPaid)],
              ].map(([label, value]) => (
                <View key={label} style={{ width: "50%", paddingHorizontal: 6, marginBottom: 10 }}>
                  <ThemedText variant="small" color={colors.muted}>
                    {label}
                  </ThemedText>
                  <ThemedText variant="body">{value}</ThemedText>
                </View>
              ))}
            </View>

            {l.renewedFromLoanId ? (
              <ThemedText
                variant="small"
                color={colors.blue}
                style={{ marginTop: 4 }}
                onPress={() => router.push(`/personal-loans/${l.renewedFromLoanId}`)}
              >
                Renewed from Loan #{l.renewedFromLoanId}
              </ThemedText>
            ) : null}
            {l.renewedToLoanId ? (
              <ThemedText
                variant="small"
                color={colors.blue}
                style={{ marginTop: 4 }}
                onPress={() => router.push(`/personal-loans/${l.renewedToLoanId}`)}
              >
                Renewed to Loan #{l.renewedToLoanId}
              </ThemedText>
            ) : null}

            <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
              <View style={{ flex: 1 }}>
                <GoldButton
                  title={downloadingBond ? "Preparing…" : "Download Bond"}
                  variant="outline"
                  onPress={downloadBond}
                  disabled={downloadingBond}
                />
              </View>
              {canUpdate && l.status === "Active" ? (
                <View style={{ flex: 1 }}>
                  <GoldButton title="Renew Loan" onPress={openRenew} />
                </View>
              ) : null}
            </View>
          </Card>

          {error ? (
            <Card>
              <ThemedText variant="small" color={colors.red}>
                {error}
              </ThemedText>
            </Card>
          ) : null}

          {/* --- Collect payment ------------------------------------------- */}
          {canUpdate && l.status === "Active" ? (
            <Card>
              <ThemedText variant="h3" style={{ marginBottom: 8 }}>
                Collect Payment
              </ThemedText>
              <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 10 }}>
                Outstanding balance: {fmt(l.outstandingAmount)}
              </ThemedText>
              <GoldTextInput
                label="Amount"
                keyboardType="numeric"
                placeholder={`e.g. ${Math.min(l.installmentAmount, l.outstandingAmount)}`}
                value={collectAmount}
                onChangeText={setCollectAmount}
              />
              <ChipSelect options={PAYMENT_METHODS} value={collectMethod} onChange={setCollectMethod} label="Method" />
              <GoldTextInput label="Reference" value={collectReference} onChangeText={setCollectReference} />
              <GoldTextInput label="Note" value={collectDescription} onChangeText={setCollectDescription} />
              <GoldButton
                title="Collect"
                onPress={() => collect.mutate()}
                loading={collect.isPending}
                disabled={!collectAmount || Number(collectAmount) <= 0}
              />
            </Card>
          ) : null}

          {/* --- Renew ------------------------------------------------------- */}
          {renewOpen ? (
            <Card>
              <ThemedText variant="h3" style={{ marginBottom: 8 }}>
                Renew Loan
              </ThemedText>
              <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 10 }}>
                Current outstanding balance: {fmt(l.outstandingAmount)}
              </ThemedText>
              <GoldTextInput label="New Principal Amount (₹)" keyboardType="numeric" value={renewPrincipal} onChangeText={setRenewPrincipal} />
              <GoldTextInput label="Number of Installments" keyboardType="numeric" value={renewTenure} onChangeText={setRenewTenure} />
              <ChipSelect label="Interest Type" options={["Flat", "Percentage"] as const} value={renewInterestType} onChange={setRenewInterestType} />
              <GoldTextInput label="Interest Value" keyboardType="numeric" value={renewInterestValue} onChangeText={setRenewInterestValue} />
              <ChipSelect label="Collection Frequency" options={["Daily", "Weekly", "Monthly"] as const} value={renewFrequency} onChange={setRenewFrequency} />

              {renewPreview.data ? (
                <View style={{ backgroundColor: colors.goldPale, borderRadius: 12, padding: 12, marginBottom: 12 }}>
                  <ThemedText variant="small">Rollover (old outstanding): {fmt(renewPreview.data.rollover)}</ThemedText>
                  <ThemedText variant="small">New interest: {fmt(renewPreview.data.interestAmount)}</ThemedText>
                  <ThemedText variant="small">Cash paid to customer: {fmt(renewPreview.data.disbursedAmount)}</ThemedText>
                  <ThemedText variant="small">New repayment obligation: {fmt(renewPrincipalNum)}</ThemedText>
                  {renewPreview.data.shortfall ? (
                    <ThemedText variant="small" color={colors.red} style={{ marginTop: 6 }}>
                      ⚠ New principal is not enough to cover the outstanding balance and interest.
                    </ThemedText>
                  ) : null}
                </View>
              ) : null}

              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <GoldButton title="Cancel" variant="outline" onPress={() => setRenewOpen(false)} />
                </View>
                <View style={{ flex: 1 }}>
                  <GoldButton
                    title="Confirm Renewal"
                    onPress={() => renew.mutate()}
                    loading={renew.isPending}
                    disabled={!renewPrincipal || !renewTenure || !!renewPreview.data?.shortfall}
                  />
                </View>
              </View>
            </Card>
          ) : null}

          {/* --- Schedule ------------------------------------------------------ */}
          <Card>
            <ThemedText variant="h3" style={{ marginBottom: 8 }}>
              Schedule
            </ThemedText>
            {schedule.isError ? (
              <ThemedText variant="small" color={colors.red}>
                Could not load the schedule.
              </ThemedText>
            ) : schedule.isLoading ? (
              <ThemedText variant="small" color={colors.muted}>
                Loading…
              </ThemedText>
            ) : schedule.items.length === 0 ? (
              <ThemedText variant="small" color={colors.muted}>
                No installments.
              </ThemedText>
            ) : (
              schedule.items.map((s) => (
                <View
                  key={s.id}
                  style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line }}
                >
                  <ThemedText variant="small" style={{ width: 28 }}>
                    #{s.sequenceNo}
                  </ThemedText>
                  <ThemedText variant="small" style={{ flex: 1 }}>
                    {s.dueDate.slice(0, 10)}
                  </ThemedText>
                  <ThemedText variant="small" style={{ width: 90, textAlign: "right" }}>
                    {fmt(s.amount)}
                  </ThemedText>
                  <View style={{ width: 96, alignItems: "flex-end" }}>
                    <StatusPill status={s.status === "PartiallyPaid" ? "Partially Paid" : s.status} />
                  </View>
                </View>
              ))
            )}
            <Pager page={schedule.page} totalPages={schedule.totalPages} onChange={schedule.setPage} />
          </Card>

          {/* --- Payment History ------------------------------------------------ */}
          <Card>
            <ThemedText variant="h3" style={{ marginBottom: 8 }}>
              Payment History
            </ThemedText>
            {payments.isError ? (
              <ThemedText variant="small" color={colors.red}>
                Could not load payments.
              </ThemedText>
            ) : payments.isLoading ? (
              <ThemedText variant="small" color={colors.muted}>
                Loading…
              </ThemedText>
            ) : payments.items.length === 0 ? (
              <ThemedText variant="small" color={colors.muted}>
                No payments yet.
              </ThemedText>
            ) : (
              payments.items.map((p) => (
                <View
                  key={p.id}
                  style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line }}
                >
                  <ThemedText variant="small" style={{ flex: 1 }}>
                    {p.paidOn.slice(0, 10)}
                  </ThemedText>
                  <ThemedText variant="small" style={{ width: 90, textAlign: "right" }}>
                    {fmt(p.amount)}
                  </ThemedText>
                  <ThemedText variant="small" color={colors.muted} style={{ width: 90, textAlign: "right" }} numberOfLines={1}>
                    {p.method}
                  </ThemedText>
                </View>
              ))
            )}
            <Pager page={payments.page} totalPages={payments.totalPages} onChange={payments.setPage} />
          </Card>
        </ScrollView>
      </View>
    </ScreenContainer>
  );
}
