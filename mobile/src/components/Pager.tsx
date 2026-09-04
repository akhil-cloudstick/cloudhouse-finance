import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { ThemedText } from "./ThemedText";
import { colors } from "../theme/colors";

// Explicit Prev/Next page buttons — mirrors the web app's own Pager
// (frontend/modules/customers/components/CustomerDetail.tsx) rather than
// mobile's earlier infinite-scroll-on-reach-bottom pattern. `page` is
// 1-based; `hasMore` (from the backend's {items,hasMore} envelope) is what
// enables Next, since these tables don't carry a total row count.
export function Pager({
  page,
  hasMore,
  onChange,
  loading,
}: {
  page: number;
  hasMore: boolean;
  onChange: (page: number) => void;
  loading?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => onChange(page - 1)}
        disabled={page <= 1 || loading}
        style={[styles.btn, (page <= 1 || loading) && styles.btnDisabled]}
      >
        <ThemedText variant="small" color={page <= 1 || loading ? colors.muted : colors.ink}>
          ← Prev
        </ThemedText>
      </Pressable>
      <ThemedText variant="small" color={colors.muted}>
        Page {page}
      </ThemedText>
      <Pressable
        onPress={() => onChange(page + 1)}
        disabled={!hasMore || loading}
        style={[styles.btn, (!hasMore || loading) && styles.btnDisabled]}
      >
        <ThemedText variant="small" color={!hasMore || loading ? colors.muted : colors.ink}>
          Next →
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, paddingHorizontal: 4 },
  btn: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9 },
  btnDisabled: { opacity: 0.5 },
});
