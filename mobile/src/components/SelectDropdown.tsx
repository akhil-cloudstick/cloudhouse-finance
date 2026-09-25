import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { ThemedText } from "./ThemedText";
import { Icon } from "./Icon";
import { colors } from "../theme/colors";
import { useTheme } from "../theme/ThemeProvider";

// Plain (non-typing) dropdown: tap the field to open the option list, tap an
// option to pick it. `open` is owned by the screen (like SearchDropdown) so a
// tap elsewhere can close it; this component stops its own touches from
// bubbling to that handler.
export function SelectDropdown<T extends string>({
  label,
  value,
  options,
  onChange,
  open,
  onOpenChange,
}: {
  label?: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: 14 }} onTouchStart={(e) => e.stopPropagation()}>
      {label ? (
        <ThemedText variant="label" color={colors.muted} style={{ marginBottom: 6 }}>
          {label}
        </ThemedText>
      ) : null}
      <Pressable onPress={() => onOpenChange(!open)} style={styles.field}>
        <ThemedText variant="body" style={{ flex: 1 }}>
          {value}
        </ThemedText>
        <View style={{ transform: [{ rotate: open ? "90deg" : "-90deg" }] }}>
          <Icon name="chevronLeft" size={14} color={colors.muted} />
        </View>
      </Pressable>
      {open ? (
        <View style={styles.list}>
          {options.map((opt, i) => (
            <Pressable
              key={opt}
              onPress={() => {
                onChange(opt);
                onOpenChange(false);
              }}
              style={[styles.row, i > 0 && styles.divider, opt === value && { backgroundColor: colors.brandPale }]}
            >
              <ThemedText variant="body" color={opt === value ? colors.brandDeep : colors.ink}>
                {opt}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  list: {
    marginTop: 6,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  row: { paddingVertical: 12, paddingHorizontal: 14 },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
});
