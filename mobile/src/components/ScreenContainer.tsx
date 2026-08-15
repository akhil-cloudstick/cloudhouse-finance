import React from "react";
import { StyleSheet, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../theme/colors";

export function ScreenContainer({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  // edges omits "top": the floating header (FloatingHeader) already sits
  // inside the top safe-area inset, so applying it again here would leave
  // a double gap under the header on every screen.
  return (
    <SafeAreaView edges={["bottom", "left", "right"]} style={[styles.container, style]}>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivory, padding: 16 },
});
