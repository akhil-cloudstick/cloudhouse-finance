import React from "react";
import { ActivityIndicator, View, StyleSheet } from "react-native";
import { useTheme } from "../theme/ThemeProvider";

// Shared "data hasn't arrived yet" buffer — a centered spinner in place of
// the old "Loading…" text, used the same way on every page and subpage.
// `full` centers within the whole remaining screen height; the default
// centers within its own (usually smaller, e.g. per-table) container.
export function Loading({ full, style }: { full?: boolean; style?: { marginVertical?: number } }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.box, full && styles.full, style]}>
      <ActivityIndicator size="small" color={colors.brand} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: "center", justifyContent: "center", paddingVertical: 24 },
  full: { flex: 1, minHeight: 200 },
});
