import React, { useState } from "react";
import { ScrollView, View, Pressable, StyleSheet } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { ChipSelect } from "../../../src/components/ChipSelect";
import { colors } from "../../../src/theme/colors";
import { useDebouncedValue } from "../../../src/hooks/useDebouncedValue";
import { listCustomers } from "../../../src/api/customers";
import { createPersonalLoan, InterestType, Frequency } from "../../../src/api/personalLoans";
import { Customer } from "../../../src/types/customer";
import { fmt } from "../../../src/lib/format";
import { ApiError } from "../../../src/api/client";

// Mirrors frontend/modules/personal-loans/components/NewPersonalLoanModal.tsx's
// client-side preview of backend/internal/personalloan/service.go's
// computeInterest — the backend recomputes and is the source of truth.
function computeInterest(principal: number, interestType: InterestType, value: number): number {
  const raw = interestType === "Percentage" ? (principal * value) / 100 : value;
  return Math.round(raw * 100) / 100;
}

export default function NewPersonalLoanScreen() {
  const router = useRouter();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerFocused, setCustomerFocused] = useState(false);
  const debouncedCustomerQuery = useDebouncedValue(customerQuery);

  const [principal, setPrincipal] = useState("");
  const [interestType, setInterestType] = useState<InterestType>("Flat");
  const [interestValue, setInterestValue] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("Daily");
  const [tenureCount, setTenureCount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const customerResults = useQuery({
    queryKey: ["newPersonalLoanCustomers", debouncedCustomerQuery],
    queryFn: () => listCustomers(debouncedCustomerQuery || undefined),
    enabled: customerFocused,
  });

  const principalNum = +principal || 0;
  const interestValueNum = +interestValue || 0;
  const tenureNum = +tenureCount || 0;
  const interestAmount = principalNum > 0 ? computeInterest(principalNum, interestType, interestValueNum) : 0;
  const disbursedAmount = Math.round((principalNum - interestAmount) * 100) / 100;
  const installmentAmount = tenureNum > 0 ? Math.round((principalNum / tenureNum) * 100) / 100 : 0;

  const submit = useMutation({
    mutationFn: () =>
      createPersonalLoan({
        branchId: customer!.branchId,
        customerId: customer!.id,
        principalAmount: principalNum,
        interestType,
        interestValue: interestValueNum,
        frequency,
        tenureCount: tenureNum,
      }),
    onSuccess: (loan) => {
      router.replace(`/personal-loans/${loan.id}`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not create the loan — try again."),
  });

  function validate(): string | null {
    if (!customer) return "Please select a customer.";
    if (!principalNum || principalNum <= 0) return "Please enter the principal amount.";
    if (!tenureNum || tenureNum <= 0) return "Please enter the number of installments.";
    if (interestValueNum < 0) return "Interest value must not be negative.";
    if (interestAmount >= principalNum) return "Interest amount must be less than the principal amount.";
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
        <ScrollView
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
        >
          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <ThemedText variant="h3">Customer</ThemedText>
              {customerFocused && !customer ? (
                <Pressable onPress={() => setCustomerFocused(false)} hitSlop={8}>
                  <ThemedText variant="small" color={colors.goldDeep}>
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
                  label="Search customer"
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
              Loan Terms
            </ThemedText>
            <GoldTextInput
              label="Principal Amount (₹)"
              keyboardType="numeric"
              placeholder="e.g. 5000"
              value={principal}
              onChangeText={setPrincipal}
            />
            <GoldTextInput
              label="Number of Installments"
              keyboardType="numeric"
              placeholder="e.g. 50"
              value={tenureCount}
              onChangeText={setTenureCount}
            />
            <ChipSelect label="Interest Type" options={["Flat", "Percentage"] as const} value={interestType} onChange={setInterestType} />
            <GoldTextInput
              label={interestType === "Flat" ? "Interest Value (₹)" : "Interest Value (%)"}
              keyboardType="numeric"
              placeholder={interestType === "Flat" ? "e.g. 100" : "e.g. 2"}
              value={interestValue}
              onChangeText={setInterestValue}
            />
            <ChipSelect label="Collection Frequency" options={["Daily", "Weekly", "Monthly"] as const} value={frequency} onChange={setFrequency} />

            {principalNum > 0 && tenureNum > 0 ? (
              <View style={{ backgroundColor: colors.goldPale, borderRadius: 12, padding: 12, marginTop: 4 }}>
                <ThemedText variant="small">Interest amount: {fmt(interestAmount)}</ThemedText>
                <ThemedText variant="small">Disbursed to customer: {fmt(disbursedAmount)}</ThemedText>
                <ThemedText variant="small">
                  Installment amount: {fmt(installmentAmount)} / {frequency}
                </ThemedText>
                <ThemedText variant="small">Repayment obligation: {fmt(principalNum)}</ThemedText>
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
            title={submit.isPending ? "Creating…" : "Create & Disburse"}
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
    backgroundColor: colors.ivory,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  dropdownRow: { paddingVertical: 10, paddingHorizontal: 12 },
  dropdownDivider: { borderTopWidth: 1, borderTopColor: colors.line },
});
