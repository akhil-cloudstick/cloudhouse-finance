import React, { useContext, useMemo } from "react";
import { ScrollView, ScrollViewProps } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { SheetScrollContext } from "./BottomSheetModal";

/** A scroller nested inside a sheet's content (e.g. the calendar's year
 * grid). The sheet's drag-to-close pan otherwise grabs every vertical drag
 * before a plain inner ScrollView can scroll; here the pan is held back
 * while the finger is on this list, so it scrolls normally. */
export function SheetNestedScrollView(props: ScrollViewProps & { ref?: React.Ref<ScrollView> }) {
  const ctx = useContext(SheetScrollContext);
  const native = useMemo(() => (ctx ? Gesture.Native().blocksExternalGesture(ctx.pan) : null), [ctx]);
  const sv = <ScrollView nestedScrollEnabled {...props} />;
  return native ? <GestureDetector gesture={native}>{sv}</GestureDetector> : sv;
}
