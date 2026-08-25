import React from "react";
import { View, StyleSheet, ViewStyle, Platform } from "react-native";
import { BlurView } from "expo-blur";
import { colors } from "../theme/colors";

// `blur` swaps the card's solid fill for a translucent one — used where a
// "glass" surface was asked for (My Loans list rows, the Payment History
// card) rather than every Card everywhere. Real Android blur
// (`blurMethod="dimezisBlurView"`) needs an explicit `blurTarget` ref onto
// a `BlurTargetView` wrapping whatever should be sampled, which isn't wired
// up here — without it expo-blur falls back to no blur but keeps warning
// about it on every render, so Android just gets the translucent tint with
// no blur prop at all. iOS's BlurView blurs natively without that wiring.
export function Card({
  children,
  style,
  blur,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  blur?: boolean;
}) {
  if (blur) {
    const Surface = Platform.OS === "ios" ? BlurView : View;
    return (
      <Surface
        {...(Platform.OS === "ios" ? { intensity: 30, tint: "light" as const } : {})}
        style={[styles.card, styles.cardBlur, style]}
      >
        {children}
      </Surface>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    marginBottom: 12,
  },
  cardBlur: { backgroundColor: "rgba(255, 253, 247, 0.55)", overflow: "hidden" },
});
