import React from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@/common/theme/colors";

type ScreenContainerProps = { children: React.ReactNode; style?: ViewStyle };

export function ScreenContainer({ children, style }: ScreenContainerProps) {
  // edges omits "top"/"bottom": FloatingHeader and AppTabBar already reserve those insets.
  return (
    <SafeAreaView edges={["left", "right"]} style={[styles.container, style]}>
      {/* "height" on Android needs windowSoftInputMode="resize" in app.json, not "pan", to avoid fighting this. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {children}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 16, paddingBottom: 0 },
  flex: { flex: 1 },
});
