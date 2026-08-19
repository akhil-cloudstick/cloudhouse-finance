import React from "react";
import { StyleSheet, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../theme/colors";

export function ScreenContainer({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  // edges omits "top" and "bottom": the floating header (FloatingHeader)
  // already sits inside the top safe-area inset, and the tab bar (AppTabBar)
  // is a sibling row below the scene that reserves its own bottom inset —
  // applying either edge here again would double that gap.
  return (
    <SafeAreaView edges={["left", "right"]} style={[styles.container, style]}>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivory, padding: 16, paddingBottom: 0 },
});
