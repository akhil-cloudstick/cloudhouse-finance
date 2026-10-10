import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { colors as C } from "@/common/theme/colors";

let fadeId = 0;
type FadeProps = {
  from: "top" | "bottom";
  height: number;
  solidAt?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
};

/** Smooth vertical fade in the page colour. `from` is the solid end. Used
 * under every header (solid at top → clear) and above the tab bar (clear →
 * solid from `solidAt`, matching the prototype's .tabfade 65% stop). */
export function Fade({
  from,
  height,
  solidAt = 0,
  color = C.bg,
  style,
}: FadeProps) {
  const id = React.useMemo(() => `pfade${++fadeId}`, []);
  // Several intermediate stops ease the ramp so the edge never reads as a
  // hard line (a two-stop linear ramp shows a visible band on Android).
  const steps = 12;
  const stops = Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const eased = t * t * (3 - 2 * t);
    return { offset: t, opacity: eased };
  });
  return (
    <View pointerEvents="none" style={[{ height }, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            {[
              ...(from === "top"
                ? stops.map((st) => <Stop key={st.offset} offset={st.offset} stopColor={color} stopOpacity={1 - st.opacity} />)
                : stops.map((st) => <Stop key={st.offset} offset={st.offset * (solidAt || 1)} stopColor={color} stopOpacity={st.opacity} />)),
              ...(from === "bottom" && solidAt ? [<Stop key="end" offset={1} stopColor={color} stopOpacity={1} />] : []),
            ]}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
