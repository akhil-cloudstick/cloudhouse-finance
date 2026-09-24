import React, { useState } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { GutterScrollView } from "../../../src/components/Gutter";
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
import { BottomSheetModal, SheetScrollView } from "../../../src/components/BottomSheetModal";
import { Icon } from "../../../src/components/Icon";
import { fmt } from "../../../src/lib/format";
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

function StatusChip({ active }: { active: boolean }) {
  const tone = statusColors(active ? "green" : "muted");
  return (
    <ThemedText
      variant="label"
      style={{ backgroundColor: tone.bg, color: tone.fg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, fontSize: 12 }}
    >
      {active ? "Active" : "Retired"}
    </ThemedText>
  );
}

// One card per plan — just the name and status; the full terms live in the
// description sheet opened on tap.
function PlanCard({ plan, onPress }: { plan: InvestmentPlan; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.card}>
      <View style={{ flex: 1 }}>
        <ThemedText variant="body" style={{ fontSize: 16, fontWeight: "600" }}>
          {plan.name}
        </ThemedText>
        {plan.productType === "Bond" ? (
          <ThemedText variant="small" color={colors.muted}>
            Bond
          </ThemedText>
        ) : null}
      </View>
      <StatusChip active={plan.isActive} />
      <View style={{ transform: [{ rotate: "180deg" }] }}>
        <Icon name="chevronLeft" size={14} color={colors.muted} />
      </View>
    </Pressable>
  );
}

function DetailRow({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.detailRow}>
      <ThemedText variant="small" color={colors.muted}>
        {k}
      </ThemedText>
      <ThemedText variant="body">{v}</ThemedText>
    </View>
  );
}

export default function InvestmentPlansScreen() {
  const queryClient = useQueryClient();
  const plans = useQuery({ queryKey: ["investmentPlans", "all"], queryFn: () => listInvestmentPlans(false) });

  const [form, setForm] = useState<FormState | null>(null);
  const [viewing, setViewing] = useState<InvestmentPlan | null>(null);
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
        <GutterScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {!form ? (
            <>
              <View style={{ paddingHorizontal: 8, marginBottom: 12 }}>
                <GoldButton title="+ New Plan" onPress={openCreate} />
              </View>
              {plans.isLoading ? (
                <ThemedText variant="small" color={colors.muted}>Loading…</ThemedText>
              ) : (plans.data ?? []).length === 0 ? (
                <ThemedText variant="small" color={colors.muted}>No plans yet.</ThemedText>
              ) : (
                (plans.data ?? []).map((p) => <PlanCard key={p.id} plan={p} onPress={() => setViewing(p)} />)
              )}
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
        </GutterScrollView>
      </View>

      <BottomSheetModal visible={!!viewing} onClose={() => setViewing(null)}>
        {viewing ? (
          <SheetScrollView showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <ThemedText variant="h3" color={colors.brandDeep} style={{ flex: 1 }}>
                {viewing.name}
              </ThemedText>
              <StatusChip active={viewing.isActive} />
            </View>
            <View style={styles.detailBox}>
              <DetailRow k="Product Type" v={viewing.productType} />
              <DetailRow k="Interest" v={`${viewing.interestRatePercent}% p.a. · ${viewing.interestRateType}`} />
              <DetailRow k="Payout" v={viewing.engine === "Live" ? "Single Payout" : `Fixed Payout · ${viewing.payoutFrequency}`} />
              <DetailRow k="Tenure" v={`${viewing.tenureMonths} months`} />
              <DetailRow k="Minimum Principal" v={fmt(viewing.minPrincipal)} />
            </View>
            <GoldButton
              title="Edit Plan"
              variant="outline"
              onPress={() => {
                const p = viewing;
                setViewing(null);
                openEdit(p);
              }}
              style={{ marginTop: 14 }}
            />
          </SheetScrollView>
        ) : null}
      </BottomSheetModal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 16,
    marginBottom: 10,
    boxShadow: "0px 5px 10px rgba(43, 26, 94, 0.2)",
  },
  detailBox: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, backgroundColor: colors.card },
  detailRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, gap: 12 },
});
