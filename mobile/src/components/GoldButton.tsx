import React from "react";
import { Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { colors } from "../theme/colors";
import { ThemedText } from "./ThemedText";

type Props = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "outline";
};

export function GoldButton({ title, onPress, disabled, loading, variant = "primary" }: Props) {
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
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.ivory : colors.goldDeep} />
      ) : (
        <ThemedText variant="label" color={isPrimary ? colors.ivory : colors.goldDeep}>
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  primary: { backgroundColor: colors.goldDeep },
  outline: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.goldDeep },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
