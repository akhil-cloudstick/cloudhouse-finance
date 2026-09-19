import React, { useState } from "react";
import { ScrollView, View, Pressable, StyleSheet } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { ChipSelect } from "../../../src/components/ChipSelect";
import { GoldCheckbox } from "../../../src/components/GoldCheckbox";
import { colors, statusColors } from "../../../src/theme/colors";
import { ApiError } from "../../../src/api/client";
import { listInvestmentPlans, createInvestmentPlan, updateInvestmentPlan, CreatePlanInput } from "../../../src/api/investments";
import { InvestmentPlan, InterestRateType, InvestmentEngine, InvestmentProductType, PayoutFrequency } from "../../../src/types/investment";

// Admin-only "Manage Plans" screen — mirrors web's InvestmentPlansModal.tsx:
// lists every plan (active AND retired, since existing investments still
// reference retired plans) plus an inline create/edit form for one plan at
// a time, reached from the Investments list's header.
const FIXED_PAYOUT_FREQUENCIES: PayoutFrequency[] = ["Monthly", "Quarterly", "Yearly"];
const FREQ_STEP_MONTHS: Record<string, number> = { Monthly: 1, Quarterly: 3, Yearly: 12 };

type FormState = {
  id: number | null;
  name: string;
  productType: InvestmentProductType;
  interestRateType: InterestRateType;
  interestRatePercent: string;
  engine: InvestmentEngine;
  payoutFrequency: PayoutFrequency;
  tenureMonths: string;
  minPrincipal: string;
  isActive: boolean;
};

const BLANK_FORM: FormState = {
  id: null,
  name: "",
  productType: "Deposit",
  interestRateType: "Simple",
  interestRatePercent: "",
  engine: "Schedule",
  payoutFrequency: "Monthly",
  tenureMonths: "",
  minPrincipal: "",
  isActive: true,
};

function PlanRow({ plan, onPress }: { plan: InvestmentPlan; onPress: () => void }) {
  const tone = statusColors(plan.isActive ? "green" : "muted");
  const payoutLabel = plan.engine === "Live" ? "Single Payout" : "Fixed Payout";
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <View style={{ flex: 1 }}>
        <ThemedText variant="body">
          {plan.name}
          {plan.productType === "Bond" ? " · Bond" : ""}
        </ThemedText>
        <ThemedText variant="small" color={colors.muted}>
          {plan.interestRateType} · {plan.interestRatePercent}% · {plan.payoutFrequency} · {plan.tenureMonths}mo · {payoutLabel}
        </ThemedText>
      </View>
      <ThemedText
        variant="label"
        style={{ backgroundColor: tone.bg, color: tone.fg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, fontSize: 11.5 }}
      >
        {plan.isActive ? "Active" : "Retired"}
      </ThemedText>
    </Pressable>
  );
}

export default function InvestmentPlansScreen() {
  const queryClient = useQueryClient();
  const plans = useQuery({ queryKey: ["investmentPlans", "all"], queryFn: () => listInvestmentPlans(false) });

  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  function openCreate() {
    setForm(BLANK_FORM);
    setError(null);
  }

  function openEdit(p: InvestmentPlan) {
    setForm({
      id: p.id,
      name: p.name,
      productType: p.productType,
      interestRateType: p.interestRateType,
      interestRatePercent: String(p.interestRatePercent),
      engine: p.engine,
      payoutFrequency: p.engine === "Schedule" ? p.payoutFrequency : "Monthly",
      tenureMonths: String(p.tenureMonths),
      minPrincipal: String(p.minPrincipal),
      isActive: p.isActive,
    });
    setError(null);
  }

  function validate(f: FormState): string | null {
    if (!f.name.trim()) return "Please enter a plan name.";
    const rate = Number(f.interestRatePercent);
    if (isNaN(rate) || rate < 0) return "Interest rate must be 0 or more.";
    const tenure = Number(f.tenureMonths);
    if (!tenure || tenure <= 0) return "Tenure must be greater than 0.";
    if (f.engine === "Schedule") {
      const step = FREQ_STEP_MONTHS[f.payoutFrequency] ?? 1;
      if (tenure % step !== 0) return `Tenure months must divide evenly by ${f.payoutFrequency}'s ${step}-month step.`;
    }
    return null;
  }

  const save = useMutation({
    mutationFn: () => {
      const f = form!;
      const input: CreatePlanInput = {
        name: f.name.trim(),
        productType: f.productType,
        interestRateType: f.interestRateType,
        interestRatePercent: Number(f.interestRatePercent),
        payoutFrequency: f.engine === "Schedule" ? f.payoutFrequency : "Monthly",
        tenureMonths: Number(f.tenureMonths),
        minPrincipal: Number(f.minPrincipal || 0),
        isActive: f.isActive,
        engine: f.engine,
      };
      return f.id ? updateInvestmentPlan(f.id, input) : createInvestmentPlan(input);
    },
    onSuccess: () => {
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ["investmentPlans"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save the plan — try again."),
  });

  function submitPress() {
    if (!form) return;
    const v = validate(form);
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    save.mutate();
  }

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <View style={{ flex: 1, paddingHorizontal: 8, paddingTop: 20 }}>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {!form ? (
            <>
              <View style={{ paddingHorizontal: 8, marginBottom: 12 }}>
                <GoldButton title="+ New Plan" onPress={openCreate} />
              </View>
              <Card>
                {plans.isLoading ? (
                  <ThemedText variant="small" color={colors.muted}>Loading…</ThemedText>
                ) : (plans.data ?? []).length === 0 ? (
                  <ThemedText variant="small" color={colors.muted}>No plans yet.</ThemedText>
                ) : (
                  (plans.data ?? []).map((p, i) => (
                    <View key={p.id} style={i > 0 ? styles.divider : undefined}>
                      <PlanRow plan={p} onPress={() => openEdit(p)} />
                    </View>
                  ))
                )}
              </Card>
            </>
          ) : (
            <Card>
              <ThemedText variant="h3" style={{ marginBottom: 8 }}>
                {form.id ? "Edit Plan" : "New Plan"}
              </ThemedText>
              <GoldTextInput label="Plan Name" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />
              <ChipSelect
                label="Product Type"
                options={["Deposit", "Bond"] as const}
                value={form.productType}
                onChange={(v) => setForm({ ...form, productType: v })}
              />
              <ChipSelect
                label="Interest Rate Type"
                options={["Simple", "Compound"] as const}
                value={form.interestRateType}
                onChange={(v) => setForm({ ...form, interestRateType: v })}
              />
              <GoldTextInput
                label="Interest Rate (% p.a.)"
                keyboardType="numeric"
                value={form.interestRatePercent}
                onChangeText={(v) => setForm({ ...form, interestRatePercent: v })}
              />
              <ChipSelect
                label="Payout"
                options={["Schedule", "Live"] as const}
                value={form.engine}
                onChange={(v) => setForm({ ...form, engine: v, payoutFrequency: "Monthly" })}
              />
              {form.engine === "Schedule" ? (
                <ChipSelect
                  label="Payout Frequency"
                  options={FIXED_PAYOUT_FREQUENCIES}
                  value={form.payoutFrequency}
                  onChange={(v) => setForm({ ...form, payoutFrequency: v })}
                />
              ) : null}
              <GoldTextInput
                label="Tenure (months)"
                keyboardType="numeric"
                value={form.tenureMonths}
                onChangeText={(v) => setForm({ ...form, tenureMonths: v })}
              />
              <GoldTextInput
                label="Minimum Principal (₹)"
                keyboardType="numeric"
                value={form.minPrincipal}
                onChangeText={(v) => setForm({ ...form, minPrincipal: v })}
              />
              <Pressable
                onPress={() => setForm({ ...form, isActive: !form.isActive })}
                style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }}
              >
                <GoldCheckbox value={form.isActive} onValueChange={(v) => setForm({ ...form, isActive: v })} />
                <ThemedText variant="small">Active — offered for new investments</ThemedText>
              </Pressable>

              {error ? (
                <ThemedText variant="small" color={colors.red} style={{ marginTop: 8, marginBottom: 4 }}>
                  {error}
                </ThemedText>
              ) : null}

              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                <View style={{ flex: 1 }}>
                  <GoldButton title="Cancel" variant="outline" onPress={() => setForm(null)} />
                </View>
                <View style={{ flex: 1 }}>
                  <GoldButton title="Save" onPress={submitPress} loading={save.isPending} />
                </View>
              </View>
            </Card>
          )}
          <View style={{ height: 24 }} />
        </ScrollView>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
});
