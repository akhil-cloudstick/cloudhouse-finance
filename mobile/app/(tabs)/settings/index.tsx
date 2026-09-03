import React, { useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { colors, statusColors } from "../../../src/theme/colors";
import { listApiKeys, setApiKey } from "../../../src/api/settings";
import { ApiKeyView, ApiKeyCategory } from "../../../src/types/apiKey";
import { ApiError } from "../../../src/api/client";
import { useRefetchOnFocus } from "../../../src/hooks/useRefetchOnFocus";

// Administrator-only, matching web — this whole route is hidden from the
// More sheet for non-Administrators (src/components/MoreSheet.tsx), and the
// backend's own RBAC check would 403 a non-Administrator regardless.
export default function SettingsScreen() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ApiKeyCategory | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["api-keys"],
    queryFn: listApiKeys,
  });

  useRefetchOnFocus(refetch);

  const save = useMutation({
    mutationFn: (category: ApiKeyCategory) => setApiKey(category, value),
    onSuccess: () => {
      setEditing(null);
      setValue("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <FlatList<ApiKeyView>
        data={data ?? []}
        keyExtractor={(item) => item.category}
        contentContainerStyle={{ paddingHorizontal: 8, paddingTop: 20, paddingBottom: 16 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={
          <ThemedText color={colors.muted}>
            {isLoading ? "Loading…" : isError ? "Could not load API keys." : "No categories found."}
          </ThemedText>
        }
        renderItem={({ item }) => {
          const tone = statusColors(item.configured ? "green" : "muted");
          const isEditing = editing === item.category;
          return (
            <Card>
              <ThemedText variant="h3">{item.category.replace(/_/g, " ")}</ThemedText>
              <ThemedText
                variant="label"
                style={{
                  marginTop: 6,
                  marginBottom: 8,
                  alignSelf: "flex-start",
                  backgroundColor: tone.bg,
                  color: tone.fg,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 6,
                }}
              >
                {item.configured ? "Configured" : "Not configured"}
              </ThemedText>
              {isEditing ? (
                <View>
                  <GoldTextInput
                    label="New value"
                    secureTextEntry
                    value={value}
                    onChangeText={setValue}
                  />
                  {error ? (
                    <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
                      {error}
                    </ThemedText>
                  ) : null}
                  <GoldButton
                    title="Save"
                    onPress={() => save.mutate(item.category)}
                    loading={save.isPending}
                    disabled={!value}
                  />
                </View>
              ) : (
                <GoldButton
                  title="Edit"
                  variant="outline"
                  onPress={() => {
                    setEditing(item.category);
                    setValue("");
                    setError(null);
                  }}
                />
              )}
            </Card>
          );
        }}
      />
    </ScreenContainer>
  );
}
