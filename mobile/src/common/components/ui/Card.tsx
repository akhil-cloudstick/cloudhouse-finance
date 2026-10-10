import React from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { s } from "./cardStyles";

type CardProps = { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void };

/** .card — white rounded card with the page gutter. */
export function Card({ children, style, onPress }: CardProps) {
  if (onPress)
    return (
      <Pressable style={[s.card, style]} onPress={onPress}>
        {children}
      </Pressable>
    );
  return <View style={[s.card, style]}>{children}</View>;
}
