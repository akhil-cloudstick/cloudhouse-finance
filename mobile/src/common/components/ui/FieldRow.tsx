import React from "react";
import { View } from "react-native";
import { s } from "./formHelpers";

type FieldRowProps = { children: React.ReactNode };

/** .field-row — children should be <Field>s; each flexes equally. */
export function FieldRow({ children }: FieldRowProps) {
  return (
    <View style={s.fieldRow}>
      {React.Children.map(children, (c) => (c ? <View style={{ flex: 1 }}>{c}</View> : null))}
    </View>
  );
}
