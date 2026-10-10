import React from "react";
import { Pressable, View } from "react-native";
import { Txt } from "./Txt";
import { s } from "./formHelpers";

type OrnamentCardProps = { title: string; onRemove?: () => void; children: React.ReactNode };

/** .ornament-card */
export function OrnamentCard({ title, onRemove, children }: OrnamentCardProps) {
  return (
    <View style={s.orn}>
      <View style={s.ornHead}>
        <Txt style={s.ornTitle}>{title}</Txt>
        {onRemove ? (
          <Pressable onPress={onRemove} hitSlop={8}>
            <Txt style={s.ornRemove}>Remove</Txt>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}
