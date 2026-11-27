import React from "react";
import { View, StyleSheet, ViewStyle, Platform } from "react-native";
import { BlurView } from "expo-blur";
import { colors } from "@/common/theme/colors";

type CardProps = {
  children: React.ReactNode;
  style?: ViewStyle;
  blur?: boolean;
};

// Android's real blur needs an unwired blurTarget ref, so it gets a translucent tint with no blur prop instead.
export function Card({
  children,
  style,
  blur,
}: CardProps) {
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
