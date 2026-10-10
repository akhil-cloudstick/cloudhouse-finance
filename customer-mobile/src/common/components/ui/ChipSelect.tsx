import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { colors } from "@/common/theme/colors";
import { ThemedText } from "./ThemedText";

type ChipSelectProps<T extends string> = {
  options: readonly T[];
  value: T | undefined;
  onChange: (v: T) => void;
  label?: string;
};

// Ported from mobile/src/components/ChipSelect.tsx, re-pointed at this
// app's own theme files — same styling/behavior, just this app's colors.
export function ChipSelect<T extends string>({
  options,
  value,
  onChange,
  label,
}: ChipSelectProps<T>) {
  return (
    <View style={{ marginBottom: 14 }}>
      {label ? (
        <ThemedText variant="label" color={colors.muted} style={{ marginBottom: 6 }}>
          {label}
        </ThemedText>
      ) : null}
      <View style={styles.wrap}>
        {options.map((opt) => {
          const active = opt === value;
          return (
            <Pressable
              key={opt}
              onPress={() => onChange(opt)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <ThemedText variant="small" color={active ? colors.bg : colors.ink}>
                {opt}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipActive: { backgroundColor: colors.brandDeep, borderColor: colors.brandDeep },
});
