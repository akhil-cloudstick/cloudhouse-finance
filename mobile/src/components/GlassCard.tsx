import React from "react";
import { View, StyleSheet, Platform, ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { colors } from "../theme/colors";

// Drop-in replacement for Card — same {children, style} shape — used across
// the Dashboard for its "glassy" card treatment (see the approved
// dashboard-glass-preview artifact).
//
// Real translucency (a see-through, blurred fill) is iOS-only, via
// BlurView. Android renders an OPAQUE card here instead — not a stylistic
// choice, a hard platform limitation: Android's `elevation` shadow requires
// an opaque compositing surface on the view that carries it, and forcing a
// non-opaque (alpha < 1) backgroundColor onto that same view is unreliable
// — it's what produced the split "padding area looks glassy, the card
// doesn't" double-surface look (tried and confirmed broken twice: once
// with overflow:"hidden" in the mix, once without — the alpha+elevation
// combination itself is the problem, not overflow). The rest of this app's
// shadowed cards (ExpandableTable.tsx's tableCardStyle) already avoid this
// by staying fully opaque; Android's GlassCard now does too, keeping the
// bigger "undershadow" and a soft gold-tinted border for a glass-adjacent
// look without the broken translucency. If real Android glass is wanted
// later, it needs expo-blur's experimental Android blur method wired up
// with a BlurTargetView (see GoldTextInput.tsx's `blur` prop comment for
// why that isn't done anywhere in this app yet) — a separate, bigger piece
// of work, not a style tweak.
export function GlassCard({ children, style }: { children: React.ReactNode; style?: ViewStyle | ViewStyle[] }) {
  const Inner = Platform.OS === "ios" ? BlurView : View;
  const innerProps = Platform.OS === "ios" ? { intensity: 34, tint: "light" as const } : {};
  return (
    <Inner
      style={[
        styles.glass,
        Platform.OS === "ios" ? [styles.iosTranslucent, styles.iosClip] : styles.androidOpaque,
        style,
      ]}
      {...innerProps}
    >
      {children}
    </Inner>
  );
}

const styles = StyleSheet.create({
  glass: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
    // Softer, quieter "undershadow" than before — reads as a light lift
    // rather than a heavy drop, matching the approved modern/minimal
    // mockups (dashboard-mockup artifact).
    shadowColor: colors.charcoal,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  iosTranslucent: {
    borderColor: "rgba(255,255,255,0.6)",
    backgroundColor: "rgba(255,253,247,0.5)",
  },
  iosClip: { overflow: "hidden" },
  androidOpaque: {
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
});
