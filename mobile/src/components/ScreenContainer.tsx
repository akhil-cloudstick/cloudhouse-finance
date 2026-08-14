import React from "react";
import { SafeAreaView, StyleSheet, ViewStyle } from "react-native";
import { colors } from "../theme/colors";

export function ScreenContainer({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <SafeAreaView style={[styles.container, style]}>{children}</SafeAreaView>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivory, padding: 16 },
});
