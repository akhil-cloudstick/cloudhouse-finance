import React from "react";
import { View, StyleSheet, ViewStyle, Platform } from "react-native";
import { colors } from "../theme/colors";

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    marginBottom: 12,
    // Flatter, quieter shadow than before — a hint of lift rather than a
    // heavy drop, matching the approved modern/minimal mockups.
    ...Platform.select({
      ios: {
        shadowColor: colors.nav,
        shadowOpacity: 0.05,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 3 },
      },
      android: { elevation: 2 },
    }),
  },
});
