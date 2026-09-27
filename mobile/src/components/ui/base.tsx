import React from "react";
import { Animated, Easing, Platform, RefreshControl, StyleSheet, Text, View, type TextProps, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { colors as C } from "../../theme/colors";

export { C };

// Staff UI text: the prototype uses the platform system face
// (-apple-system / Roboto), so no fontFamily is set — RN's default IS the
// system font on both platforms. Base size is the prototype's .app 14.5.
export function Txt({ style, ...rest }: TextProps) {
  return <Text allowFontScaling={false} {...rest} style={[styles.txt, style]} />;
}

let fadeId = 0;

/** Smooth vertical fade in the page colour. `from` is the solid end. Used
 * under every header (solid at top → clear) and above the tab bar (clear →
 * solid from `solidAt`, matching the prototype's .tabfade 65% stop). */
export function Fade({
  from,
  height,
  solidAt = 0,
  color = C.bg,
  style,
}: {
  from: "top" | "bottom";
  height: number;
  solidAt?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
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

/** The staff app's spinner: a faint track with an outer arc that whips
 * round clockwise (eased, so it surges and settles each turn) and a shorter
 * inner arc turning the other way at a steady pace. */
export function Spinner({ color = C.brandDeep, size = 22 }: { color?: string; size?: number }) {
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

/** The one loading indicator for the staff app ("buffering"): centred in a
 * list/section while its data loads or reloads, in a list footer while the
 * next page loads, and inside buttons while a mutation runs. */
export function Buffering({
  size = "small",
  color = C.brandDeep,
  style,
  block,
  delay = block ? 250 : 0,
}: {
  size?: "small" | "large";
  color?: string;
  style?: StyleProp<ViewStyle>;
  /** Fills a list/section area and centres the spinner. */
  block?: boolean;
  /** Hold the spinner back this long (ms): a load that finishes sooner shows
   * its content straight away instead of flashing the spinner first. */
  delay?: number;
}) {
  const [show, setShow] = React.useState(delay <= 0);
  React.useEffect(() => {
    if (delay <= 0) return;
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  const px = size === "large" ? 34 : 24;
  return (
    <View style={[block ? styles.block : styles.inline, style]}>
      {show ? <Spinner color={color} size={px} /> : <View style={{ width: px, height: px }} />}
    </View>
  );
}

/** Pull-to-refresh with the app's own loader: the native RefreshControl
 * still provides the pull gesture, but its system spinner is hidden
 * (moved off-screen on Android, transparent on iOS) — the list shows its
 * <Buffering /> while `refreshing` instead, same as any other reload. */
export function pullRefreshControl(refreshing: boolean, onRefresh: () => void) {
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor="transparent"
      colors={["transparent"]}
      progressBackgroundColor="transparent"
      progressViewOffset={Platform.OS === "android" ? -1000 : undefined}
    />
  );
}

/** .local-search-empty */
export function EmptyText({ children }: { children: React.ReactNode }) {
  return <Txt style={styles.empty}>{children}</Txt>;
}

export function initialsOf(name?: string | null) {
  return (name ?? "?")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

const styles = StyleSheet.create({
  txt: { color: C.ink, fontSize: 14.5 },
  block: { paddingVertical: 40, alignItems: "center", justifyContent: "center" },
  inline: { paddingVertical: 16, alignItems: "center", justifyContent: "center" },
  empty: { paddingVertical: 24, paddingHorizontal: 18, textAlign: "center", color: C.muted, fontSize: 12.5 },
});
