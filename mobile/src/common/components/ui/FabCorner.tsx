import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { tabBarLift } from "@/common/theme/layout";
import { s, FAB_CAPTION_H } from "./shellContext";

type FabCornerProps = {
  onPress: () => void;
  icon?: string;
  label?: string;
  side?: "left" | "right";
  /** Small name shown under the button (e.g. "Plans"). */
  caption?: string;
};

// ---------------------------------------------------------------------------
// Floating page elements
// ---------------------------------------------------------------------------

/** .fab-corner — bottom-right, above the tab bar. */
export function FabCorner({
  onPress,
  icon = "plus",
  label,
  side = "right",
  caption,
}: FabCornerProps) {
  const insets = useSafeAreaInsets();
  if (caption)
    return (
      // The caption sits where an uncaptioned FAB's bottom edge would be, so
      // the whole button + label stays clear of the tab bar below it.
      <View style={[s.fabWrap, { bottom: 96 + tabBarLift(insets.bottom) }, side === "left" ? { left: 16 } : { right: 16 }]} pointerEvents="box-none">
        <Pressable style={[s.fab, s.fabInline]} onPress={onPress} accessibilityLabel={label ?? caption}>
          <PIcon name={icon} color="#fff" />
        </Pressable>
        <Txt style={s.fabCaption} numberOfLines={1}>{caption}</Txt>
      </View>
    );
  return (
    <Pressable style={[s.fab, { bottom: 96 + FAB_CAPTION_H + tabBarLift(insets.bottom) }, side === "left" ? { left: 16, right: undefined } : null]} onPress={onPress} accessibilityLabel={label ?? "Add"}>
      <PIcon name={icon} color="#fff" />
    </Pressable>
  );
}
