import React, { useState } from "react";
import { ScrollView, View, Pressable, StyleSheet } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { colors } from "../../../src/theme/colors";
import { useDebouncedValue } from "../../../src/hooks/useDebouncedValue";
import { listCustomers } from "../../../src/api/customers";
import { listInvestmentPlans, createInvestment } from "../../../src/api/investments";
import { Customer } from "../../../src/types/customer";
import { InvestmentPlan } from "../../../src/types/investment";
import { fmt } from "../../../src/lib/format";
import { ApiError } from "../../../src/api/client";

// Simplified from web's NewInvestmentModal.tsx: picks any customer (web
// restricts the search to Investor-type customers specifically — mobile's
// customer search has no such filter yet) and an active plan; the backend
// snapshots the plan's rate/frequency/tenure and generates the full payout
// schedule server-side, same as web.
export default function NewInvestmentScreen() {
  const router = useRouter();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerFocused, setCustomerFocused] = useState(false);
  const debouncedCustomerQuery = useDebouncedValue(customerQuery);

  const [plan, setPlan] = useState<InvestmentPlan | null>(null);
  const [principal, setPrincipal] = useState("");
  const [error, setError] = useState<string | null>(null);

  const customerResults = useQuery({
    queryKey: ["newInvestmentCustomers", debouncedCustomerQuery],
    queryFn: () => listCustomers(debouncedCustomerQuery || undefined),
    enabled: customerFocused,
  });

  const plans = useQuery({
    queryKey: ["investmentPlans", "active"],
    queryFn: () => listInvestmentPlans(true),
  });

  const principalNum = +principal || 0;

  const submit = useMutation({
    mutationFn: () =>
      createInvestment({
        branchId: customer!.branchId,
        customerId: customer!.id,
        planId: plan!.id,
        principalAmount: principalNum,
      }),
    onSuccess: (investment) => {
      router.replace(`/investments/${investment.id}`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not create the investment — try again."),
  });

  function validate(): string | null {
    if (!customer) return "Please select an investor.";
    if (!plan) return "Please select an investment plan.";
    if (!principalNum || principalNum <= 0) return "Please enter the principal amount.";
    if (principalNum < plan.minPrincipal) return `Principal must be at least ${fmt(plan.minPrincipal)} for this plan.`;
    return null;
  }

  function submitPress() {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    submit.mutate();
  }

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <View style={{ flex: 1, paddingHorizontal: 8, paddingTop: 20 }}>
        <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <ThemedText variant="h3">Investor</ThemedText>
              {customerFocused && !customer ? (
                <Pressable onPress={() => setCustomerFocused(false)} hitSlop={8}>
                  <ThemedText variant="small" color={colors.brandDeep}>
                    Hide list
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
            {customer ? (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View>
                  <ThemedText variant="body">{customer.name}</ThemedText>
                  <ThemedText variant="small" color={colors.muted}>
                    {customer.code} · {customer.phone}
                  </ThemedText>
                </View>
                <Pressable onPress={() => setCustomer(null)}>
                  <ThemedText variant="small" color={colors.red}>
                    Change
                  </ThemedText>
                </Pressable>
              </View>
            ) : (
              <View>
                <GoldTextInput
                  label="Search investor"
                  placeholder="Name, phone, or code…"
                  value={customerQuery}
                  onChangeText={setCustomerQuery}
                  onFocus={() => setCustomerFocused(true)}
                />
                {customerFocused && (customerResults.data ?? []).length > 0 ? (
                  <View style={styles.dropdownContainer}>
                    <ScrollView nestedScrollEnabled style={{ maxHeight: 220 }} keyboardShouldPersistTaps="handled">
                      {(customerResults.data ?? []).map((c, i) => (
                        <Pressable
                          key={c.id}
                          onPress={() => {
                            setCustomer(c);
                            setCustomerFocused(false);
                          }}
                          style={[styles.dropdownRow, i > 0 && styles.dropdownDivider]}
                        >
                          <ThemedText variant="body">{c.name}</ThemedText>
                          <ThemedText variant="small" color={colors.muted}>
                            {c.code} · {c.phone}
                          </ThemedText>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                ) : null}
              </View>
            )}
          </Card>

          <Card>
            <ThemedText variant="h3" style={{ marginBottom: 8 }}>
              Investment Plan
            </ThemedText>
            {plans.isLoading ? (
              <ThemedText variant="small" color={colors.muted}>Loading plans…</ThemedText>
            ) : (plans.data ?? []).length === 0 ? (
              <ThemedText variant="small" color={colors.muted}>No active plans available.</ThemedText>
            ) : (
              <View style={{ gap: 8 }}>
                {(plans.data ?? []).map((p) => {
                  const active = p.id === plan?.id;
                  return (
                    <Pressable
                      key={p.id}
                      onPress={() => setPlan(p)}
                      style={[styles.planRow, active && styles.planRowActive]}
                    >
                      <ThemedText variant="body" color={active ? colors.card : colors.ink}>
                        {p.name}
                      </ThemedText>
                      <ThemedText variant="small" color={active ? colors.card : colors.muted}>
                        {p.interestRatePercent}% {p.payoutFrequency}, {p.tenureMonths}mo
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </Card>

          <Card>
            <ThemedText variant="h3" style={{ marginBottom: 8 }}>
              Principal Amount
            </ThemedText>
            <GoldTextInput
              label="Principal Amount (₹)"
              keyboardType="numeric"
              placeholder="e.g. 100000"
              value={principal}
              onChangeText={setPrincipal}
            />
            {plan && principalNum > 0 ? (
              <View style={{ backgroundColor: colors.brandPale, borderRadius: 12, padding: 12, marginTop: 4 }}>
                <ThemedText variant="small">Rate: {plan.interestRatePercent}% {plan.interestRateType}</ThemedText>
                <ThemedText variant="small">Payout: {plan.payoutFrequency}</ThemedText>
                <ThemedText variant="small">Tenure: {plan.tenureMonths} months</ThemedText>
                <ThemedText variant="small">Principal deposited: {fmt(principalNum)}</ThemedText>
              </View>
            ) : null}
          </Card>

          {error ? (
            <Card>
              <ThemedText variant="small" color={colors.red}>
                {error}
              </ThemedText>
            </Card>
          ) : null}

          <GoldButton
            title={submit.isPending ? "Creating…" : "Create Investment"}
            onPress={submitPress}
            loading={submit.isPending}
          />
          <View style={{ height: 24 }} />
        </ScrollView>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  dropdownContainer: {
    marginTop: 8,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  dropdownRow: { paddingVertical: 10, paddingHorizontal: 12 },
  dropdownDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  planRow: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  planRowActive: { backgroundColor: colors.brandDeep, borderColor: colors.brandDeep },
});
