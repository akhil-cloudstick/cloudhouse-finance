import React, { useEffect, useState } from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { s } from "./formHelpers";

type FieldProps = {
  label?: string;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Hold the label to see this — the phone's version of the web's hover tooltip. */
  hint?: string;
};

const HINT_MS = 4000;

// ---- .field ---------------------------------------------------------------
export function Field({ label, children, style, hint }: FieldProps) {
  const [tip, setTip] = useState(false);
  // A shown hint closes on its own, or on a tap.
  useEffect(() => {
    if (!tip) return;
    const t = setTimeout(() => setTip(false), HINT_MS);
    return () => clearTimeout(t);
  }, [tip]);
  return (
    <View style={[s.field, style]}>
      {label ? (
        hint ? (
          <Pressable onLongPress={() => setTip(true)} onPressOut={() => setTip(false)} delayLongPress={300} accessibilityHint={hint} hitSlop={{ top: 6, bottom: 6, right: 24 }} style={{ alignSelf: "flex-start" }}>
            <Txt style={s.label}>{label}</Txt>
          </Pressable>
        ) : (
          <Txt style={s.label}>{label}</Txt>
        )
      ) : null}
      {hint && tip ? (
        <Pressable
          onPress={() => setTip(false)}
          style={{ backgroundColor: C.nav, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginBottom: 8, alignSelf: "flex-start", maxWidth: "100%" }}
        >
          <Txt style={{ color: "#fff", fontSize: 12, lineHeight: 17 }}>{hint}</Txt>
        </Pressable>
      ) : null}
      {children}
    </View>
  );
}
