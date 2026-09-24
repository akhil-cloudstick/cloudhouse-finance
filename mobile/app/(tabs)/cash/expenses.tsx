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
import { colors, statusColors, StatusTone } from "../../../src/theme/colors";
import { listExpenses, createExpense, approveExpense, rejectExpense } from "../../../src/api/cash";
import { Expense } from "../../../src/types/cash";
import { useAuth } from "../../../src/auth/AuthContext";
import { ApiError } from "../../../src/api/client";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";

function toneForStatus(status: Expense["status"]): StatusTone {
  if (status === "Approved") return "green";
  if (status === "Rejected") return "red";
  return "amber";
}

export default function ExpensesScreen() {
  const queryClient = useQueryClient();
  const { employee } = useAuth();
  const isAdmin = employee?.role === "Administrator";
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("");
  const [payee, setPayee] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["expenses", "list"],
    queryFn: listExpenses,
  });

  useRefetchOnFocus(refetch);

  const create = useMutation({
    mutationFn: () =>
      createExpense({ category, amount: Number(amount), mode, payee, branchId: employee!.branchId }),
    onSuccess: () => {
      setCategory("");
      setAmount("");
      setMode("");
      setPayee("");
      setShowForm(false);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["cash-summary"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  const approve = useMutation({
    mutationFn: (id: number) => approveExpense(id, employee?.name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expenses"] }),
  });
  const reject = useMutation({
    mutationFn: (id: number) => rejectExpense(id, "Rejected from mobile app", employee?.name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expenses"] }),
  });

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: 8, paddingTop: 20 }}>
        <GoldButton
          title={showForm ? "Cancel" : "Add expense"}
          variant="outline"
          onPress={() => setShowForm((v) => !v)}
        />
      </View>
      {showForm ? (
        <Card style={{ marginHorizontal: 8, marginTop: 12 }}>
          <GoldTextInput label="Category" value={category} onChangeText={setCategory} />
          <GoldTextInput label="Amount" keyboardType="numeric" value={amount} onChangeText={setAmount} />
          <GoldTextInput label="Mode (Cash/UPI/...)" value={mode} onChangeText={setMode} />
          <GoldTextInput label="Payee" value={payee} onChangeText={setPayee} />
          {error ? (
            <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
              {error}
            </ThemedText>
          ) : null}
          <GoldButton
            title="Save"
            onPress={() => create.mutate()}
            loading={create.isPending}
            disabled={!category || !amount || !mode || !payee}
          />
        </Card>
      ) : null}
      <TopFaded>{(fade) => (
      <FlatList<Expense>
        {...fade}
        data={data ?? []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 8, paddingTop: 16, paddingBottom: TAB_BAR_SPACE }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={
          <ThemedText color={colors.muted}>
            {isLoading ? "Loading…" : isError ? "Could not load expenses." : "No expenses yet."}
          </ThemedText>
        }
        renderItem={({ item }) => {
          const tone = statusColors(toneForStatus(item.status));
          return (
            <Card>
              <ThemedText variant="h3">₹{item.amount.toLocaleString("en-IN")}</ThemedText>
              <ThemedText variant="small" color={colors.muted}>
                {item.category} · {item.payee}
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
                {item.status}
              </ThemedText>
              {isAdmin && item.status === "Pending" ? (
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                  <View style={{ flex: 1 }}>
                    <GoldButton title="Approve" onPress={() => approve.mutate(item.id)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <GoldButton title="Reject" variant="outline" onPress={() => reject.mutate(item.id)} />
                  </View>
                </View>
              ) : null}
            </Card>
          );
        }}
      />
      )}</TopFaded>
    </ScreenContainer>
  );
}
