import React from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../theme/colors";
import { useHeaderSpace } from "../theme/layout";

export function ScreenContainer({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const headerSpace = useHeaderSpace();
  // edges omits "top" and "bottom": the floating header (FloatingHeader)
  // already sits inside the top safe-area inset, and the tab bar (AppTabBar)
  // floats over the scene and clears its own bottom inset (scrollers pad by
  // TAB_BAR_SPACE instead) —
  // applying either edge here again would double that gap.
  return (
    <SafeAreaView edges={["left", "right"]} style={[styles.container, style]}>
      {/* Every form screen used to sit bare inside the SafeAreaView, so the
       * keyboard just overlaid whatever input was focused instead of the
       * screen making room for it — nothing here ever called
       * KeyboardAvoidingView. "padding" on iOS shrinks this view by the
       * keyboard's height (the ScrollView screens already wrap their fields
       * in then scroll the newly-short remainder); "height" on Android does
       * the same via windowSoftInputMode="resize" (see app.json) rather than
       * double-handling a keyboard the OS is already resizing the window
       * for under "adjustResize". */}
      <KeyboardAvoidingView
        // Content starts below the floating header; scrollers reach back up
        // under it (see useHeaderSpace) so content can scroll behind it.
        style={[styles.flex, { paddingTop: headerSpace }]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {children}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16, paddingTop: 0, paddingBottom: 0 },
  flex: { flex: 1 },
});
