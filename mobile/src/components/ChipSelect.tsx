import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { colors } from "../theme/colors";
import { ThemedText } from "./ThemedText";

// Small reusable enum-picker (role, status, etc.) — avoids a native
// dropdown dependency for the handful of fixed-choice fields across
// Employees/Cash/Auctions/Settings.
export function ChipSelect<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly T[];
  value: T | undefined;
  onChange: (v: T) => void;
  label?: string;
}) {
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
              <ThemedText variant="small" color={active ? colors.ivory : colors.ink}>
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
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: colors.goldDeep, borderColor: colors.goldDeep },
});
