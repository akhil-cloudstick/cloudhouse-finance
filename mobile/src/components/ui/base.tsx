import React from "react";
import { ActivityIndicator, StyleSheet, Text, View, type TextProps, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
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

/** The one loading indicator for the staff app ("buffering"): centred in a
 * list/section while its data loads or reloads, in a list footer while the
 * next page loads, and inside buttons while a mutation runs. */
export function Buffering({
  size = "small",
  color = C.brandDeep,
  style,
  block,
}: {
  size?: "small" | "large";
  color?: string;
  style?: StyleProp<ViewStyle>;
  /** Fills a list/section area and centres the spinner. */
  block?: boolean;
}) {
  return (
    <View style={[block ? styles.block : styles.inline, style]}>
      <ActivityIndicator size={size} color={color} />
    </View>
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
