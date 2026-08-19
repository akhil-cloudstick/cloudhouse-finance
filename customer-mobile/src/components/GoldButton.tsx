import React from "react";
import { Pressable, ActivityIndicator, StyleSheet, ViewStyle } from "react-native";
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
      // Without an explicit android_ripple/hitSlop the touch target is just
      // the laid-out box, which is correct — but only if the box actually
      // spans the width it appears to (see alignSelf in styles.base).
      hitSlop={8}
      // Temporary diagnostics for the "left/right edges don't respond"
      // report: `w=` is the button's real laid-out width, and `x=` is where
      // within that width a touch actually landed. If taps near the edges
      // never log at all, something is covering them; if they log an x well
      // inside a full w, the box is fine and the press is being cancelled.
      onLayout={(e) => console.log("[btn]", title, "w=", e.nativeEvent.layout.width, "x=", e.nativeEvent.layout.x)}
      onPressIn={(e) => console.log("[btn]", title, "pressIn x=", e.nativeEvent.locationX)}
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
        <ThemedText variant="label" color={isPrimary ? colors.ivory : colors.goldDeep}>
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // alignSelf:"stretch" so the button's own box spans the full width of its
  // container rather than depending on the parent's default alignment. In a
  // parent that aligns its children to center/flex-start (or any row
  // container), this Pressable would otherwise shrink to fit its label —
  // leaving the visible background looking full-width while only the
  // text-sized region actually accepted touches.
  base: {
    height: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    alignSelf: "stretch",
  },
  primary: { backgroundColor: colors.goldDeep },
  outline: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.goldDeep },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
