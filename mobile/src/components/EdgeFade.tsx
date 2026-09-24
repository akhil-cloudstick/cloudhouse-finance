import React, { useRef } from "react";
import { Animated, NativeScrollEvent, NativeSyntheticEvent, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { colors } from "../theme/colors";

export const TOP_FADE = 20;
export const BOTTOM_FADE = 20;
// Scroll content's bottom padding, so the last card can scroll clear of the bottom fade.
export const EDGE_FADE = BOTTOM_FADE;

// Twenty equal small steps of opacity across the fade's height, so it
// changes by the same slight increment all the way through.
const STEPS = 20;
// The bottom fade (above the navbar) peaks at this opacity rather than solid.
const BOTTOM_INTENSITY = 0.5;
const STOPS = Array.from({ length: STEPS + 1 }, (_, i) => ({ offset: i / STEPS, opacity: i / STEPS }));

let fadeSeq = 0;

// Page-coloured gradient so content scrolls out gradually at an edge.
// `opacity` lets a scroller show the top fade only once it has scrolled.
export function EdgeFade({ edge, opacity, inset = 0 }: { edge: "top" | "bottom"; opacity?: Animated.Value | Animated.AnimatedInterpolation<number>; inset?: number }) {
  const id = useRef(`edgeFade${++fadeSeq}`).current;
  const top = edge === "top";
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.fade,
        { left: -inset, right: -inset, height: top ? TOP_FADE : BOTTOM_FADE },
        top ? { top: 0 } : { bottom: 0 },
        opacity ? { opacity } : null,
      ]}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            {STOPS.map((s) => (
              // Top fade is solid at its top edge; bottom fade is solid at its bottom edge.
              <Stop key={s.offset} offset={s.offset} stopColor={colors.bg} stopOpacity={top ? 1 - s.opacity : s.opacity * BOTTOM_INTENSITY} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

/** Scroll-driven opacity for a top EdgeFade: 0 at rest, 1 after TOP_FADE px. */
export function useTopFade() {
  const scrollY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(scrollY.interpolate({ inputRange: [0, TOP_FADE], outputRange: [0, 1], extrapolate: "clamp" })).current;
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => scrollY.setValue(e.nativeEvent.contentOffset.y);
  return { opacity, onScroll };
}

/** Wraps any plain scroller: spread the given props onto it to get the top fade. */
export function TopFaded({
  children,
}: {
  children: (props: { onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void; scrollEventThrottle: number }) => React.ReactNode;
}) {
  const fade = useTopFade();
  return (
    <View style={{ flex: 1 }}>
      {children({ onScroll: fade.onScroll, scrollEventThrottle: 16 })}
      <EdgeFade edge="top" opacity={fade.opacity} />
    </View>
  );
}

const styles = StyleSheet.create({
  fade: { position: "absolute", zIndex: 10, elevation: 10 },
});
