import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { Icon } from "./Icon";
import { colors } from "../theme/colors";

/* Themed checkbox — replaces the platform `Switch` (react-native) on the
 * Release verification checklist. Two problems that had: it's a toggle
 * (iOS/Android's own green/track look), not the square gold checkmark box
 * the web app's ".ccheck" checkbox actually is, so the two apps disagreed on
 * what this control even was; and — the real "not working properly" bug —
 * platform Switch inside these rows sometimes ate the tap without firing
 * onValueChange at all, most reliably on Android inside a Pressable-heavy
 * scroll view. A plain Pressable here has no such native-control quirk to
 * hit. Mirrors ReleaseReviewModal.tsx's `.ccheck`/`.mark` styling: a 20px
 * square, gold-deep fill + white checkmark when checked, plain bordered box
 * otherwise. */
export function GoldCheckbox({
  value,
  onValueChange,
  disabled,
}: {
  value: boolean;
  /** Omit for a purely read-only display checkbox (e.g. paymentVerified,
   * which is derived server-side and was never actually a toggle). */
  onValueChange?: (next: boolean) => void;
  disabled?: boolean;
}) {
  const interactive = !disabled && !!onValueChange;
  return (
    <Pressable
      onPress={() => {
        if (interactive) onValueChange!(!value);
      }}
      disabled={!interactive}
      hitSlop={8}
      style={[styles.box, value && styles.boxChecked, disabled && styles.boxDisabled]}
    >
      {value ? <Icon name="check" size={15} color={colors.card} strokeWidth={3} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.muted,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  boxChecked: {
    borderColor: colors.brandDeep,
    backgroundColor: colors.brandDeep,
  },
  boxDisabled: { opacity: 0.5 },
});
