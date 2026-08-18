import React from "react";
import { StyleSheet, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../theme/colors";

export function ScreenContainer({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  // edges omits "top": FloatingHeader already sits inside the top safe-area
  // inset, so applying it again here would double the gap under the header.
  return (
    <SafeAreaView edges={["bottom", "left", "right"]} style={[styles.container, style]}>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivory, padding: 16 },
});
