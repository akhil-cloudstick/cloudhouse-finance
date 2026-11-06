import React from "react";
import { Animated, Easing, View, type StyleProp, type ViewStyle } from "react-native";
import { colors as C } from "@/common/theme/colors";
import { Spinner } from "./Spinner";
import { styles } from "./base";

type BufferingProps = {
  size?: "small" | "large";
  color?: string;
  style?: StyleProp<ViewStyle>;
  /** Fills a list/section area and centres the spinner. */
  block?: boolean;
  /** Hold the spinner back this long (ms): a load that finishes sooner shows
   * its content straight away instead of flashing the spinner first. */
  delay?: number;
};

/** The one loading indicator for the staff app ("buffering"): centred in a
 * list/section while its data loads or reloads, in a list footer while the
 * next page loads, and inside buttons while a mutation runs. */
export function Buffering({
  block,
  size = block ? "large" : "small",
  color = C.brandDeep,
  style,
  delay = 0,
}: BufferingProps) {
  const [show, setShow] = React.useState(delay <= 0);
  React.useEffect(() => {
    if (delay <= 0) return;
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  const px = size === "large" ? 34 : 24;
  return (
    <View style={[block ? styles.block : styles.inline, style]}>
      {/* Drawn at full strength from the first frame: a fade-in only started once the screen had
          rendered, so on a slow page the spinner turned up late, after a blank screen. */}
      {show ? <Spinner color={color} size={px} /> : <View style={{ width: px, height: px }} />}
    </View>
  );
}

const RELOAD_H = 56;

/** The spinner that opens at the top of a list or scroller while it reloads (a pull-down, a
 * search or filter change). It grows into place, fading and scaling the spinner up, and eases
 * back out when the reload ends — so the rows glide down and up instead of jumping. */
export function ReloadBuffer({ active }: { active: boolean }) {
  const [open] = React.useState(() => new Animated.Value(0));
  const [mounted, setMounted] = React.useState(active);
  // Mount as soon as it turns active (set during render, not in an effect); unmount after it has eased out.
  if (active && !mounted) setMounted(true);
  React.useEffect(() => {
    if (!active && !mounted) return;
    Animated.timing(open, { toValue: active ? 1 : 0, duration: active ? 240 : 200, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(({ finished }) => {
      if (finished && !active) setMounted(false);
    });
  }, [active, mounted, open]);
  if (!mounted) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        height: open.interpolate({ inputRange: [0, 1], outputRange: [0, RELOAD_H] }),
        opacity: open,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Animated.View style={{ transform: [{ scale: open.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }] }}>
        <Spinner color={C.brandDeep} size={28} />
      </Animated.View>
    </Animated.View>
  );
}
