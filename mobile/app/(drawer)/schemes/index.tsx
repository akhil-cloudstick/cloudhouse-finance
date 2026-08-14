import React, { useState } from "react";
import { FlatList, RefreshControl, Pressable, View } from "react-native";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { colors, statusColors } from "../../../src/theme/colors";
import { listSchemes, createScheme } from "../../../src/api/schemes";
import { Scheme } from "../../../src/types/scheme";
import { useDebouncedValue } from "../../../src/hooks/useDebouncedValue";
import { useAuth } from "../../../src/auth/AuthContext";
import { ApiError } from "../../../src/api/client";

export default function SchemesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { employee } = useAuth();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [durationMonths, setDurationMonths] = useState("");
  const [ltvPercent, setLtvPercent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["schemes", debouncedSearch],
    queryFn: () => listSchemes(debouncedSearch || undefined),
  });

  const create = useMutation({
    mutationFn: () =>
      createScheme({
        name,
        branchId: employee!.branchId,
        interestRate: Number(interestRate),
        durationMonths: Number(durationMonths),
        ltvPercent: Number(ltvPercent),
      }),
    onSuccess: () => {
      setName("");
      setInterestRate("");
      setDurationMonths("");
      setLtvPercent("");
      setShowForm(false);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["schemes"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: 16 }}>
        <GoldTextInput label="Search schemes" value={search} onChangeText={setSearch} />
        <GoldButton
          title={showForm ? "Cancel" : "Add scheme"}
          variant="outline"
          onPress={() => setShowForm((v) => !v)}
        />
      </View>

      {showForm ? (
        <Card style={{ marginHorizontal: 16, marginTop: 12 }}>
          <GoldTextInput label="Name" value={name} onChangeText={setName} />
          <GoldTextInput
            label="Interest rate (%)"
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
          {error ? (
            <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
              {error}
            </ThemedText>
          ) : null}
          <GoldButton
            title="Save"
            onPress={() => create.mutate()}
            loading={create.isPending}
            disabled={!name || !interestRate || !durationMonths || !ltvPercent}
          />
        </Card>
      ) : null}

      <FlatList<Scheme>
        data={data ?? []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={
          <ThemedText color={colors.muted}>
            {isLoading ? "Loading…" : isError ? "Could not load schemes." : "No schemes found."}
          </ThemedText>
        }
        renderItem={({ item }) => {
          const tone = statusColors(item.isActive ? "green" : "muted");
          return (
            <Pressable onPress={() => router.push(`/schemes/${item.id}`)}>
              <Card>
                <ThemedText variant="h3">{item.name}</ThemedText>
                <ThemedText variant="small" color={colors.muted}>
                  {item.code} · {item.interestRate}% · {item.durationMonths}mo · LTV {item.ltvPercent}%
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
                  {item.isActive ? "Active" : "Inactive"}
                </ThemedText>
              </Card>
            </Pressable>
          );
        }}
      />
    </ScreenContainer>
  );
}
