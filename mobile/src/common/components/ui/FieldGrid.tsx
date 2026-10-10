import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { Txt } from "./Txt";
import { s } from "./cardStyles";

type FieldGridProps = { items: { k: string; v: React.ReactNode; color?: string }[]; style?: StyleProp<ViewStyle> };

/** .ld-field-grid — 2-col key/value grid. */
export function FieldGrid({ items, style }: FieldGridProps) {
  return (
    <View style={[s.grid, style]}>
      {items.map((it) => (
        <View key={it.k} style={s.gridCell}>
          <Txt style={s.gridK}>{it.k}</Txt>
          {typeof it.v === "string" || typeof it.v === "number" ? <Txt style={[s.gridV, it.color ? { color: it.color } : null]}>{it.v}</Txt> : it.v}
        </View>
      ))}
    </View>
  );
}
