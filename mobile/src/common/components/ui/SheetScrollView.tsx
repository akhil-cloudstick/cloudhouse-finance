import { useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Keyboard, Platform, View, ScrollView, TextInput, type HostInstance, type ScrollViewInstance, type ScrollViewProps } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { notifyLayoutShift, notifyUserScroll } from "./Popover";
import { SheetScrollContext, ScrollLock } from "./BottomSheetModal";

const NO_LOCK: ScrollLock = { get: () => false, set: () => {}, subscribe: () => () => {} };
/** Use for any scrollable content inside a BottomSheetModal: it cooperates with
 * the sheet's swipe-down-to-close (pull down while at the top closes the
 * sheet). Outside a sheet it behaves like a plain ScrollView. */
export function SheetScrollView(props: ScrollViewProps) {
  const ctx = useContext(SheetScrollContext);
  const native = useMemo(() => (ctx ? Gesture.Native().simultaneousWithExternalGesture(ctx.pan) : null), [ctx]);
  const lock = ctx?.lock ?? NO_LOCK;
  const held = useSyncExternalStore(lock.subscribe, lock.get, lock.get);
  const ref = useRef<ScrollViewInstance>(null);
  const offset = useRef(0);
  const viewH = useRef(0);
  // iOS doesn't scroll a focused input into view once the keyboard shrinks the sheet (Android does), so do it manually.
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      timer = setTimeout(() => {
        const input = TextInput.State.currentlyFocusedInput?.();
        const inner = (ref.current as unknown as { getInnerViewRef?: () => HostInstance | null })?.getInnerViewRef?.();
        if (!input || !inner || !viewH.current) return;
        (input as unknown as HostInstance).measureLayout(
          inner,
          (_x, y, _w, h) => {
            const top = offset.current;
            const bottom = top + viewH.current;
            if (y + h + 16 > bottom) ref.current?.scrollTo({ y: y + h + 16 - viewH.current, animated: true });
            else if (y - 16 < top) ref.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
          },
          () => {}
        );
      }, 80);
    });
    return () => {
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, []);
  const sv = (
    <ScrollView
      ref={ref}
      bounces={false}
      // Android 12+ overscroll stretch fought the sheet's own drag, causing jitter.
      overScrollMode="never"
      scrollEventThrottle={16}
      // Android "on-drag" closed the keyboard on the first scroll touch, the sheet then
      // resized under the finger and the next section could not be reached. Keep it open
      // there (tap a non-input area / the sheet's drag-down closes it); iOS keeps its
      // interactive dismiss, which only acts when dragging down over the keyboard.
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "none"}
      {...props}
      scrollEnabled={held ? false : props.scrollEnabled}
      onScrollBeginDrag={(e) => {
        notifyUserScroll();
        props.onScrollBeginDrag?.(e);
      }}
      onLayout={(e) => {
        viewH.current = e.nativeEvent.layout.height;
        notifyLayoutShift();
        props.onLayout?.(e);
      }}
      onScroll={(e) => {
        offset.current = e.nativeEvent.contentOffset.y;
        notifyLayoutShift();
        ctx?.onScroll(e.nativeEvent.contentOffset.y);
        props.onScroll?.(e);
      }}
    />
  );
  return native ? <GestureDetector gesture={native}>{sv}</GestureDetector> : sv;
}
