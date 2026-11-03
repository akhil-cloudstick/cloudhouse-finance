import React from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { C } from "./base";

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

let heroGradId = 0;
/** The Dashboard hero's gradient — linear-gradient(135deg, nav 0%, nav2
 * 55%, brand 100%) — used behind every page header (and the status bar
 * area above it) so the whole app wears the same colour on top. */
// Memoised: it takes no props, and every header re-render (each page re-publishes its header on
// every render) would otherwise re-render the whole SVG tree for nothing.
export const HeroBackground = React.memo(function HeroBackground() {
  const id = React.useMemo(() => `heroGrad${++heroGradId}`, []);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={C.nav} />
            <Stop offset="0.55" stopColor={C.nav2} />
            <Stop offset="1" stopColor={C.brand} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
});
