import React, { useState } from "react";
import { TAB_BAR_SPACE } from "../../../src/theme/layout";
import { TopFaded } from "../../../src/components/EdgeFade";
import { FlatList, RefreshControl, View } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { ChipSelect } from "../../../src/components/ChipSelect";
import { colors, statusColors } from "../../../src/theme/colors";
import { listCashMovements, createCashMovement } from "../../../src/api/cash";
import { CashMovement } from "../../../src/types/cash";
import { ApiError } from "../../../src/api/client";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";

const TYPES = ["in", "out"] as const;

export default function CashMovementsScreen() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<(typeof TYPES)[number]>("in");
  const [source, setSource] = useState("");
  const [purpose, setPurpose] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["cash-movements", "list"],
    queryFn: listCashMovements,
  });

  useRefetchOnFocus(refetch);

  const create = useMutation({
    mutationFn: () => createCashMovement({ type, source, purpose, amount: Number(amount), bank: undefined }),
    onSuccess: () => {
      setSource("");
      setPurpose("");
      setAmount("");
      setShowForm(false);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["cash-movements"] });
      queryClient.invalidateQueries({ queryKey: ["cash-summary"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: 16 }}>
        <GoldButton
          title={showForm ? "Cancel" : "Add cash movement"}
          variant="outline"
          onPress={() => setShowForm((v) => !v)}
        />
      </View>
      {showForm ? (
        <Card style={{ marginHorizontal: 16, marginTop: 12 }}>
          <ChipSelect label="Type" options={TYPES} value={type} onChange={setType} />
          <GoldTextInput label="Source" value={source} onChangeText={setSource} />
          <GoldTextInput label="Purpose" value={purpose} onChangeText={setPurpose} />
          <GoldTextInput label="Amount" keyboardType="numeric" value={amount} onChangeText={setAmount} />
          {error ? (
            <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
              {error}
            </ThemedText>
          ) : null}
          <GoldButton
            title="Save"
            onPress={() => create.mutate()}
            loading={create.isPending}
            disabled={!source || !purpose || !amount}
          />
        </Card>
      ) : null}
      <TopFaded>{(fade) => (
      <FlatList<CashMovement>
        {...fade}
        data={data ?? []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: TAB_BAR_SPACE }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={
          <ThemedText color={colors.muted}>
            {isLoading ? "Loading…" : isError ? "Could not load cash movements." : "No movements yet."}
          </ThemedText>
        }
        renderItem={({ item }) => {
          const tone = statusColors(item.type === "in" ? "green" : "amber");
          return (
            <Card>
              <ThemedText variant="h3">
                ₹{item.amount.toLocaleString("en-IN")}
              </ThemedText>
              <ThemedText variant="small" color={colors.muted}>
                {item.source} · {item.purpose}
              </ThemedText>
              <ThemedText
                variant="label"
                style={{
                  marginTop: 8,
                  alignSelf: "flex-start",
                  backgroundColor: tone.bg,
                  color: tone.fg,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 6,
                }}
              >
                Cash {item.type}
              </ThemedText>
            </Card>
          );
        }}
      />
      )}</TopFaded>
    </ScreenContainer>
  );
}
