import React from "react";
import { Text, TextProps } from "react-native";
import { colors } from "../theme/colors";
import { typeScale } from "../theme/typography";

type Variant = keyof typeof typeScale;

export function ThemedText({
  variant = "body",
  style,
  color,
  ...rest
}: TextProps & { variant?: Variant; color?: string }) {
  return (
    <Text
      style={[typeScale[variant], { color: color ?? colors.ink }, style]}
      {...rest}
    />
  );
}
