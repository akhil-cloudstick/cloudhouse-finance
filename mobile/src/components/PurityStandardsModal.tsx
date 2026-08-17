import React, { useState } from "react";
import { FlatList, RefreshControl, View, Pressable, StyleSheet } from "react-native";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { BottomSheetModal } from "./BottomSheetModal";
import { Card } from "./Card";
import { ThemedText } from "./ThemedText";
import { GoldTextInput } from "./GoldTextInput";
import { GoldButton } from "./GoldButton";
import { colors } from "../theme/colors";
import { listPurityStandards, createPurityStandard } from "../api/purityStandards";
import { PurityStandard } from "../types/purityStandard";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { ApiError } from "../api/client";

// Purity Standards, adapted from mobile/app/(tabs)/purity-standards.tsx
// into a Modal launched from gold-rates.tsx. Currently unreferenced: the
// route is reachable on its own from the More sheet's Administration group
// (src/components/MoreSheet.tsx), so nothing launches this modal.
export function PurityStandardsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [karat, setKarat] = useState("");
  const [fineness, setFineness] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["purity-standards", debouncedSearch],
    queryFn: () => listPurityStandards(debouncedSearch || undefined),
    enabled: visible,
  });

  const create = useMutation({
    mutationFn: () =>
      createPurityStandard({
        karat: karat ? Number(karat) : undefined,
        finenessPercent: fineness ? Number(fineness) : undefined,
        label,
      }),
    onSuccess: () => {
      setKarat("");
      setFineness("");
      setLabel("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["purity-standards"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  return (
    <BottomSheetModal visible={visible} onClose={onClose} maxHeightPct={88}>
      <View style={styles.sheetHeader}>
        <ThemedText variant="h3">Purity Standards</ThemedText>
        <Pressable onPress={onClose}>
          <ThemedText variant="h3" color={colors.muted}>
            ×
          </ThemedText>
        </Pressable>
      </View>

      <Card>
            <ThemedText variant="h3" style={{ marginBottom: 8 }}>
              Add purity standard
            </ThemedText>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <GoldTextInput label="Karat" keyboardType="numeric" value={karat} onChangeText={setKarat} />
              </View>
              <View style={{ flex: 1 }}>
                <GoldTextInput
                  label="Fineness %"
                  keyboardType="numeric"
                  value={fineness}
                  onChangeText={setFineness}
                />
              </View>
            </View>
            <GoldTextInput label="Label" value={label} onChangeText={setLabel} />
            {error ? (
              <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
                {error}
              </ThemedText>
            ) : null}
            <GoldButton
              title="Add"
              onPress={() => create.mutate()}
              loading={create.isPending}
              disabled={!label || (!karat && !fineness)}
            />
          </Card>

          <GoldTextInput
            label="Search"
            placeholder="Karat, fineness, or label…"
            value={search}
            onChangeText={setSearch}
          />

          <FlatList<PurityStandard>
            data={data ?? []}
            keyExtractor={(item) => String(item.id)}
            style={{ maxHeight: 260 }}
            refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
            ListEmptyComponent={
              <ThemedText color={colors.muted}>
                {isLoading ? "Loading…" : isError ? "Could not load purity standards." : "None yet."}
              </ThemedText>
            }
            renderItem={({ item }) => (
              <Card>
                <ThemedText variant="h3">{item.label}</ThemedText>
                <ThemedText variant="small" color={colors.muted}>
                  {item.karat ? `${item.karat}K` : ""}
                  {item.karat && item.finenessPercent ? " · " : ""}
                  {item.finenessPercent ? `${item.finenessPercent}%` : ""}
                  {!item.isActive ? " · inactive" : ""}
                </ThemedText>
              </Card>
            )}
          />
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
});
