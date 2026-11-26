import React from "react";
import { Text, TextProps } from "react-native";
import { colors } from "@/common/theme/colors";
import { typeScale, textStyle } from "@/common/theme/typography";

type Variant = keyof typeof typeScale;

export function ThemedText({
  variant = "body",
  style,
  color,
  ...rest
}: TextProps & { variant?: Variant; color?: string }) {
  return (
    <Text
      style={textStyle([typeScale[variant], { color: color ?? colors.ink }, style], false)}
      {...rest}
    />
  );
}
