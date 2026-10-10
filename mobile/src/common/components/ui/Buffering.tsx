import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
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
  size = "small",
  color = C.brandDeep,
  style,
  block,
  delay = block ? 250 : 0,
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
      {show ? <Spinner color={color} size={px} /> : <View style={{ width: px, height: px }} />}
    </View>
  );
}
