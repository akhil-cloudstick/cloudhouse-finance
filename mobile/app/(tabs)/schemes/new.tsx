import React, { useState } from "react";
import { View } from "react-native";
import { GutterScrollView } from "../../../src/components/Gutter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { ChipSelect } from "../../../src/components/ChipSelect";
import { colors } from "../../../src/theme/colors";
import { createScheme } from "../../../src/api/schemes";
import { useAuth } from "../../../src/auth/AuthContext";
import { ApiError } from "../../../src/api/client";
import { ServiceChargeType, ServiceChargeMode } from "../../../src/types/scheme";

// Interest-method options mirror frontend/components/modals/SchemeModal.tsx:13
// (METHODS) — kept as free-form text there via a <Select>, but the field is a
// plain string on the backend (scheme/model.go:26 InterestMethod), so a
// ChipSelect with the same fixed options is a reasonable mobile substitute.
const METHODS = ["Monthly simple interest", "Flat monthly", "Quarterly simple", "Compound monthly"] as const;

// Mirrors web SchemeModal.tsx's CHARGE_TYPE_OPTIONS/CHARGE_MODE_OPTIONS —
// same three-value/two-value sets. ChipSelect shows the option text
// verbatim (no separate label mapping), so these use display text as the
// value and map back to the wire value (chargeTypeToWire/chargeModeToWire
// below) when saving.
const CHARGE_TYPES = ["No service charge", "Flat amount", "Percentage"] as const;
const CHARGE_MODES = ["Withhold from payout", "Add to principal"] as const;

function chargeTypeToWire(v: (typeof CHARGE_TYPES)[number]): ServiceChargeType {
  if (v === "Flat amount") return "Flat";
  if (v === "Percentage") return "Percent";
  return "None";
}
function chargeModeToWire(v: (typeof CHARGE_MODES)[number]): ServiceChargeMode {
  return v === "Add to principal" ? "AddedToPrincipal" : "WithheldFromPayout";
}

export default function NewSchemeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { employee } = useAuth();

  const [name, setName] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [durationMonths, setDurationMonths] = useState("");
  const [ltvPercent, setLtvPercent] = useState("");
  const [interestMethod, setInterestMethod] = useState<(typeof METHODS)[number]>(METHODS[0]);
  const [penalRate, setPenalRate] = useState("");
  const [conditions, setConditions] = useState("");
  // Backend defaults isActive to false (scheme/model.go:29), but the web
  // create form (frontend/components/modals/SchemeModal.tsx:32) defaults new
  // schemes to Active — mirrored here for parity.
  const [status, setStatus] = useState<"Active" | "Inactive">("Active");
  const [chargeType, setChargeType] = useState<(typeof CHARGE_TYPES)[number]>(CHARGE_TYPES[0]);
  const [chargeValue, setChargeValue] = useState("");
  const [chargeMode, setChargeMode] = useState<(typeof CHARGE_MODES)[number]>(CHARGE_MODES[0]);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      createScheme({
        name,
        branchId: employee!.branchId,
        interestRate: Number(interestRate),
        durationMonths: Number(durationMonths),
        ltvPercent: Number(ltvPercent),
        interestMethod,
        penalRate: penalRate ? Number(penalRate) : undefined,
        conditions: conditions.trim() || undefined,
        isActive: status === "Active",
        serviceChargeType: chargeTypeToWire(chargeType),
        serviceChargeValue: chargeType === CHARGE_TYPES[0] ? 0 : Number(chargeValue),
        serviceChargeMode: chargeTypeToWire(chargeType) === "None" ? undefined : chargeModeToWire(chargeMode),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schemes"] });
      router.back();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <View style={{ flex: 1, paddingHorizontal: 8, paddingTop: 20 }}>
      {/* style={{flex:1}} matters here specifically: without it this
       * ScrollView sizes itself to its own (tall — 8 fields) content height
       * instead of the space ScreenContainer's KeyboardAvoidingView actually
       * has once the keyboard opens and shrinks that space, so it never
       * establishes a bounded scrollable viewport — the keyboard just
       * covers whatever's near the bottom (Conditions, Status, the Create
       * button) with no way to scroll it into view. */}
      <GutterScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
      <Card>
        <GoldTextInput label="Name" value={name} onChangeText={setName} placeholder="e.g. Swarna Premium" />
        <GoldTextInput
          label="Interest rate (% p.a.)"
          keyboardType="numeric"
          value={interestRate}
          onChangeText={setInterestRate}
        />
        <GoldTextInput
          label="Duration (months)"
          keyboardType="numeric"
          value={durationMonths}
          onChangeText={setDurationMonths}
        />
        <GoldTextInput
          label="LTV (%)"
          keyboardType="numeric"
          value={ltvPercent}
          onChangeText={setLtvPercent}
        />
        <ChipSelect
          label="Interest calculation method"
          options={METHODS}
          value={interestMethod}
          onChange={setInterestMethod}
        />
        <GoldTextInput
          label="Penal charges (% / month)"
          keyboardType="numeric"
          value={penalRate}
          onChangeText={setPenalRate}
        />
        <GoldTextInput
          label="Applicable conditions"
          value={conditions}
          onChangeText={setConditions}
          placeholder="e.g. Interest payable monthly; penal 2%/m after due"
        />
        <ChipSelect label="Status" options={["Active", "Inactive"] as const} value={status} onChange={setStatus} />
        <ChipSelect label="Service charge" options={CHARGE_TYPES} value={chargeType} onChange={setChargeType} />
        {chargeType !== CHARGE_TYPES[0] ? (
          <>
            <GoldTextInput
              label={chargeType === "Flat amount" ? "Charge amount (₹)" : "Charge (% of principal)"}
              keyboardType="numeric"
              value={chargeValue}
              onChangeText={setChargeValue}
              placeholder={chargeType === "Flat amount" ? "e.g. 500" : "e.g. 2"}
            />
            <ChipSelect label="How the charge is collected" options={CHARGE_MODES} value={chargeMode} onChange={setChargeMode} />
          </>
        ) : null}
        {error ? (
          <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
            {error}
          </ThemedText>
        ) : null}
        <View style={{ marginTop: 4 }}>
          <GoldButton
            title="Create Scheme"
            onPress={() => create.mutate()}
            loading={create.isPending}
            disabled={!name || !interestRate || !durationMonths || !ltvPercent}
          />
        </View>
      </Card>
      </GutterScrollView>
      </View>
    </ScreenContainer>  );
}
