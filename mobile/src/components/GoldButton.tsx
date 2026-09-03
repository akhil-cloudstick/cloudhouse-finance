import React from "react";
import { Pressable, ActivityIndicator, StyleSheet, ViewStyle, Platform } from "react-native";
import { colors } from "../theme/colors";
import { ThemedText } from "./ThemedText";

type Props = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "outline";
  style?: ViewStyle;
};

export function GoldButton({ title, onPress, disabled, loading, variant = "primary", style }: Props) {
  const isPrimary = variant === "primary";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        isPrimary ? styles.primary : styles.outline,
        (disabled || loading) && styles.disabled,
        pressed && !disabled && !loading && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.ivory : colors.goldDeep} />
      ) : (
        // One step up from typeScale.label (13) — buttons read a little
        // more confident at this size without jumping all the way to body.
        <ThemedText variant="label" color={isPrimary ? colors.ivory : colors.goldDeep} style={styles.title}>
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 15 },
  base: {
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  primary: {
    backgroundColor: colors.goldDeep,
    // A soft gold-tinted lift under the primary button only — the outline
    // variant stays flat, matching the approved modern/minimal mockups.
    ...Platform.select({
      ios: {
        shadowColor: colors.goldDeep,
        shadowOpacity: 0.3,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 5 },
      },
      android: { elevation: 3 },
    }),
  },
  outline: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: colors.goldDeep },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
