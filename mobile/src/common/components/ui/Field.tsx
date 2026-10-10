import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { Txt } from "./Txt";
import { s } from "./formHelpers";

type FieldProps = { label?: string; children?: React.ReactNode; style?: StyleProp<ViewStyle> };

// ---- .field ---------------------------------------------------------------
export function Field({ label, children, style }: FieldProps) {
  return (
    <View style={[s.field, style]}>
      {label ? <Txt style={s.label}>{label}</Txt> : null}
      {children}
    </View>
  );
}
