import { useContext, useRef } from "react";
import { Pressable, View } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { s } from "./formHelpers";
import { ListDragContext } from "./Popover";

type MenuItemProps = { title: string; sub?: string; selected?: boolean; accent?: boolean; onPress: () => void; onDelete?: () => void };

// How far the finger may move between touch-down and lift-off and still count as a tap.
const TAP_SLOP = 10;

/** One row inside a dropdown list. With `onDelete` it shows an × beside the row — a sibling of the
 *  row's own Pressable, not nested in it, so tapping × never also picks the row. */
export function MenuItem({ title, sub, selected, accent, onPress, onDelete }: MenuItemProps) {
  const list = useContext(ListDragContext);
  const down = useRef({ at: 0, x: 0, y: 0 });
  const row = (
    <Pressable
      style={({ pressed }) => [s.ddItem, onDelete ? { flex: 1, minWidth: 0 } : null, selected && s.ddItemSel, pressed && !selected && { backgroundColor: C.brandFaint }]}
      onPressIn={(e) => {
        down.current = { at: Date.now(), x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
      }}
      onPress={(e) => {
        // A finger that moved is a scroll of the list, not a pick. The row moves with the list,
        // so the finger is still "on" it at lift-off and the press fires — on iOS it isn't
        // cancelled when the list starts scrolling. Checked by distance, and by the list's own
        // drag event as a backup.
        const moved = Math.hypot(e.nativeEvent.pageX - down.current.x, e.nativeEvent.pageY - down.current.y);
        if (moved > TAP_SLOP || (list && list.lastDrag() >= down.current.at)) return;
        onPress();
      }}
    >
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
  if (!onDelete) return row;
  return (
    <View style={{ flexDirection: "row", alignItems: "stretch" }}>
      {row}
      <Pressable
        onPress={onDelete}
        accessibilityLabel={`Delete ${title}`}
        style={({ pressed }) => [{ paddingHorizontal: 12, justifyContent: "center", borderRadius: 8 }, pressed && { backgroundColor: C.brandFaint }]}
      >
        <Txt style={{ fontSize: 18, fontWeight: "700", color: C.muted }}>×</Txt>
      </Pressable>
    </View>
  );
}
