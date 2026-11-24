import React, { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
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
  // Web only: the SVG gradient sized in pixels from the layout.
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // iOS / Android: a native CSS gradient on the view itself. It is sized by layout alone, so after a
  // rotation it covers the new width in the same frame (the SVG had to be re-measured first, so the
  // header showed half old / half new until that caught up).
  if (Platform.OS !== "web") {
    return (
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundImage: `linear-gradient(135deg, ${C.nav} 0%, ${C.nav2} 55%, ${C.brand} 100%)` }]}
      />
    );
  }
  // Sized in pixels from the layout: a "100%" SVG kept its first (portrait) width after a rotation,
  // leaving the rest of the header in a second shade.
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize((o) => (o && o.w === width && o.h === height ? o : { w: width, h: height }));
      }}
    >
      <Svg width={size ? size.w : "100%"} height={size ? size.h : "100%"}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={C.nav} />
            <Stop offset="0.55" stopColor={C.nav2} />
            <Stop offset="1" stopColor={C.brand} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={size ? size.w : "100%"} height={size ? size.h : "100%"} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
});
