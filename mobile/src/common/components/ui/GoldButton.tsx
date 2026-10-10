import React from "react";
import { Pressable, ActivityIndicator, StyleSheet, ViewStyle, Platform, View } from "react-native";
import type { Colors } from "@/common/theme/colors";
import { useTheme, useThemedStyles } from "@/common/theme/ThemeProvider";
import { ThemedText } from "./ThemedText";
import { Icon } from "./Icon";

type Props = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "outline";
  style?: ViewStyle;
  /** Icon.tsx glyph name shown before the title. */
  icon?: string;
};

export function GoldButton({ title, onPress, disabled, loading, variant = "primary", style, icon }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
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
        <ActivityIndicator color={isPrimary ? colors.bg : colors.brandDeep} />
      ) : (
        // One step up from typeScale.label (13) — buttons read a little
        // more confident at this size without jumping all the way to body.
        <View style={styles.row}>
          {icon ? <Icon name={icon} size={18} color={isPrimary ? colors.bg : colors.brandDeep} /> : null}
          <ThemedText variant="label" color={isPrimary ? colors.bg : colors.brandDeep} style={styles.title} numberOfLines={1}>
            {title}
          </ThemedText>
        </View>
      )}
    </Pressable>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({
  title: { fontSize: 15 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  base: {
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  primary: {
    backgroundColor: c.brandDeep,
    // A soft gold-tinted lift under the primary button only — the outline
    // variant stays flat, matching the approved modern/minimal mockups.
    ...Platform.select({
      ios: {
        shadowColor: c.brandDeep,
        shadowOpacity: 0.3,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 5 },
      },
      android: { elevation: 3 },
    }),
  },
  outline: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: c.brandDeep },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
