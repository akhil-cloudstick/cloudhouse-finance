import { Pressable } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { s } from "./formHelpers";

type MenuItemProps = { title: string; sub?: string; selected?: boolean; accent?: boolean; onPress: () => void };

/** One row inside a dropdown list. */
export function MenuItem({ title, sub, selected, accent, onPress }: MenuItemProps) {
  return (
    <Pressable style={({ pressed }) => [s.ddItem, selected && s.ddItemSel, pressed && !selected && { backgroundColor: C.brandFaint }]} onPress={onPress}>
      <Txt style={[s.ddItemTxt, (selected || accent) && { color: C.brandDeep }, accent && { fontWeight: "700" }]} numberOfLines={2}>
        {title}
      </Txt>
      {sub ? (
        <Txt style={{ fontSize: 11, color: C.muted, marginTop: 1 }} numberOfLines={1}>
          {sub}
        </Txt>
      ) : null}
    </Pressable>
  );
}
