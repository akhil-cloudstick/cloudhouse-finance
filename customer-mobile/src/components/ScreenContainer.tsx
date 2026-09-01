import React from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../theme/colors";

export function ScreenContainer({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  // edges omits "top" and "bottom": FloatingHeader already sits inside the
  // top safe-area inset, and AppTabBar is a sibling row below the scene that
  // reserves its own bottom inset — applying either edge here again would
  // double that gap.
  return (
    <SafeAreaView edges={["left", "right"]} style={[styles.container, style]}>
      {/* Every form screen used to sit bare inside the SafeAreaView, so the
       * keyboard just overlaid whatever input was focused instead of the
       * screen making room for it — nothing here ever called
       * KeyboardAvoidingView. "padding" on iOS shrinks this view by the
       * keyboard's height (the ScrollView screens already wrap their fields
       * in then scroll the newly-short remainder); "height" on Android does
       * the same via windowSoftInputMode="resize" (see app.json — was
       * "pan", switched to match, since "pan" moves the whole native window
       * instead of resizing it and fights this view's own height change). */}
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
  container: { flex: 1, backgroundColor: colors.ivory, padding: 16, paddingBottom: 0 },
  flex: { flex: 1 },
});
