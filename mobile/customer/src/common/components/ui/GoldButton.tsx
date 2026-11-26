import React from "react";
import { Pressable, ActivityIndicator, StyleSheet, ViewStyle } from "react-native";
import { colors } from "@/common/theme/colors";
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
      hitSlop={8}
      style={({ pressed }) => [
        styles.base,
        isPrimary ? styles.primary : styles.outline,
        (disabled || loading) && styles.disabled,
        pressed && !disabled && !loading && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.bg : colors.brandDeep} />
      ) : (
        <ThemedText variant="label" color={isPrimary ? colors.bg : colors.brandDeep}>
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // alignSelf:"stretch" so the Pressable spans its container's width rather than shrinking to fit the label.
  base: {
    height: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    alignSelf: "stretch",
  },
  primary: { backgroundColor: colors.brandDeep },
  outline: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.brandDeep },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
