import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { colors } from "../theme/colors";
import { ThemedText } from "./ThemedText";
import { useTheme } from "../theme/ThemeProvider";

// Segmented tab strip for switching between a few equally-important views
// within one Card (e.g. Schedule / Payment History / Schedule History) —
// same visual language as ChipSelect but full-width, evenly split segments.
export function Tabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.wrap, { backgroundColor: colors.bg, borderColor: colors.line }]}>
      {options.map((opt) => {
        const active = opt === value;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(opt)}
            style={[styles.tab, active && { backgroundColor: colors.card, borderColor: colors.line }]}
          >
            <ThemedText variant="small" color={active ? colors.ink : colors.muted} style={active ? styles.activeLabel : undefined} numberOfLines={1}>
              {opt}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", borderRadius: 12, borderWidth: 1, padding: 3, marginBottom: 12, gap: 3 },
  tab: { flex: 1, borderRadius: 9, borderWidth: 1, borderColor: "transparent", paddingVertical: 8, alignItems: "center" },
  activeLabel: { fontWeight: "600" },
});
