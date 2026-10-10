import React from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { colors as C } from "@/common/theme/colors";

type SpinnerProps = { color?: string; size?: number };

/** The staff app's spinner: a faint track with an outer arc that whips
 * round clockwise (eased, so it surges and settles each turn) and a shorter
 * inner arc turning the other way at a steady pace. */
export function Spinner({ color = C.brandDeep, size = 22 }: SpinnerProps) {
  const [outer] = React.useState(() => new Animated.Value(0));
  const [inner] = React.useState(() => new Animated.Value(0));
  React.useEffect(() => {
    const a = Animated.loop(Animated.timing(outer, { toValue: 1, duration: 1100, easing: Easing.bezier(0.55, 0.1, 0.35, 1), useNativeDriver: true }));
    const b = Animated.loop(Animated.timing(inner, { toValue: 1, duration: 1600, easing: Easing.linear, useNativeDriver: true }));
    a.start();
    b.start();
    return () => {
      a.stop();
      b.stop();
    };
  }, [outer, inner]);
  const stroke = Math.max(2, size / 9);
  const r1 = size / 2 - stroke / 2;
  const r2 = r1 - stroke * 1.9;
  const c1 = 2 * Math.PI * r1;
  const c2 = 2 * Math.PI * r2;
  const spin = (v: Animated.Value, dir: 1 | -1) => ({
    transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${360 * dir}deg`] }) }],
  });
  const arc = (r: number, circ: number, frac: number, opacity: number) => (
    <Svg width={size} height={size}>
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeOpacity={opacity}
        strokeWidth={stroke}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={`${circ * frac} ${circ}`}
      />
    </Svg>
  );
  return (
    <View style={{ width: size, height: size }} accessibilityRole="progressbar" accessibilityLabel="Loading">
      <View style={StyleSheet.absoluteFill}>
        <Svg width={size} height={size}>
          <Circle cx={size / 2} cy={size / 2} r={r1} stroke={color} strokeOpacity={0.14} strokeWidth={stroke} fill="none" />
        </Svg>
      </View>
      <Animated.View style={[StyleSheet.absoluteFill, spin(outer, 1)]}>{arc(r1, c1, 0.3, 1)}</Animated.View>
      {r2 > 2 ? <Animated.View style={[StyleSheet.absoluteFill, spin(inner, -1)]}>{arc(r2, c2, 0.22, 0.55)}</Animated.View> : null}
    </View>
  );
}
