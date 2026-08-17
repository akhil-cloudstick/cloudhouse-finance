import React, { useState } from "react";
import { View, ScrollView } from "react-native";
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

// Interest-method options mirror frontend/components/modals/SchemeModal.tsx:13
// (METHODS) — kept as free-form text there via a <Select>, but the field is a
// plain string on the backend (scheme/model.go:26 InterestMethod), so a
// ChipSelect with the same fixed options is a reasonable mobile substitute.
const METHODS = ["Monthly simple interest", "Flat monthly", "Quarterly simple", "Compound monthly"] as const;

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
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schemes"] });
      router.back();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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
      </ScrollView>
    </ScreenContainer>
  );
}
