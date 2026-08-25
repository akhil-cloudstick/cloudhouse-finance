import React, { useState } from "react";
import { FlatList, RefreshControl, Pressable, View } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { colors } from "../../../src/theme/colors";
import { listLockers, createLocker } from "../../../src/api/lockers";
import { Locker } from "../../../src/types/locker";
import { useAuth } from "../../../src/auth/AuthContext";
import { ApiError } from "../../../src/api/client";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";

export default function LockersScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { employee } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState("");
  const [capacity, setCapacity] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["lockers"],
    queryFn: listLockers,
  });

  useRefetchOnFocus(refetch);

  const create = useMutation({
    mutationFn: () => createLocker({ code, branchId: employee!.branchId, capacity: Number(capacity) }),
    onSuccess: () => {
      setCode("");
      setCapacity("");
      setShowForm(false);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["lockers"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: 16 }}>
        <GoldButton
          title={showForm ? "Cancel" : "Add locker"}
          variant="outline"
          onPress={() => setShowForm((v) => !v)}
        />
      </View>
      {showForm ? (
        <Card style={{ marginHorizontal: 16, marginTop: 12 }}>
          <GoldTextInput label="Code" value={code} onChangeText={setCode} />
          <GoldTextInput label="Capacity" keyboardType="numeric" value={capacity} onChangeText={setCapacity} />
          {error ? (
            <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
              {error}
            </ThemedText>
          ) : null}
          <GoldButton
            title="Save"
            onPress={() => create.mutate()}
            loading={create.isPending}
            disabled={!code || !capacity}
          />
        </Card>
      ) : null}
      <FlatList<Locker>
        data={data ?? []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={
          <ThemedText color={colors.muted}>
            {isLoading ? "Loading…" : isError ? "Could not load lockers." : "No lockers found."}
          </ThemedText>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/packets?lockerId=${item.id}`)}>
            <Card>
              <ThemedText variant="h3">{item.code}</ThemedText>
              <ThemedText variant="small" color={colors.muted}>
                Capacity {item.capacity}
                {item.occupied !== undefined ? ` · Occupied ${item.occupied}` : ""}
                {!item.isActive ? " · inactive" : ""}
              </ThemedText>
            </Card>
          </Pressable>
        )}
      />
    </ScreenContainer>
  );
}
