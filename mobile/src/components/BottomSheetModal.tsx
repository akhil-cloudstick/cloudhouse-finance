import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Animated, BackHandler, Easing, Keyboard, Pressable, View, StyleSheet, ScrollView, ScrollViewProps, FlatList, FlatListProps } from "react-native";
import { Gesture, GestureDetector, type PanGesture } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme/colors";
import { nextSheetId, sheetStore } from "./SheetHost";

type SheetScrollCtx = { pan: PanGesture; onScroll: (y: number) => void };
const SheetScrollContext = createContext<SheetScrollCtx | null>(null);

/** Use for any scrollable content inside a BottomSheetModal: it cooperates with
 * the sheet's swipe-down-to-close (pull down while at the top closes the
 * sheet). Outside a sheet it behaves like a plain ScrollView. */
export function SheetScrollView(props: ScrollViewProps) {
  const ctx = useContext(SheetScrollContext);
  const native = useMemo(() => (ctx ? Gesture.Native().simultaneousWithExternalGesture(ctx.pan) : null), [ctx]);
  const sv = (
    <ScrollView
      bounces={false}
      scrollEventThrottle={16}
      {...props}
      onScroll={(e) => {
        ctx?.onScroll(e.nativeEvent.contentOffset.y);
        props.onScroll?.(e);
      }}
    />
  );
  return native ? <GestureDetector gesture={native}>{sv}</GestureDetector> : sv;
}

/** FlatList variant of SheetScrollView. */
export function SheetFlatList<T>(props: FlatListProps<T>) {
  return <FlatList {...props} renderScrollComponent={(p) => <SheetScrollView {...p} />} />;
}

// Shared "rises up from the bottom" sheet, publishing into SheetHost rather than
// rendering a native Modal (see SheetHost.tsx's doc comment).
export function BottomSheetModal({
  visible,
  onClose,
  children,
  maxHeightPct = 88,
  dragToClose = true,
  bare = false,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxHeightPct?: number;
  dragToClose?: boolean;
  /** Prototype sheet styling (.modal-card.sheet-bottom): white card, 24
   * radius, no side padding — the content lays out its own head/body. */
  bare?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(0)).current;
  const backdropOpacity = useRef(
    translateY.interpolate({ inputRange: [0, 600], outputRange: [1, 0], extrapolate: "clamp" })
  ).current;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const idRef = useRef<string | undefined>(undefined);
  if (!idRef.current) idRef.current = nextSheetId();
  const id = idRef.current;

  const closeSheet = () => {
    // No reset to 0 here — that snapped the sheet back on-screen for a frame
    // before it unmounted (the flash). The open effect re-positions it.
    Animated.timing(translateY, { toValue: 1000, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() =>
      closeRef.current()
    );
  };

  // Whole-sheet drag. A SheetScrollView inside reports its offset here; the
  // sheet only follows the finger while that list is at its top, measuring
  // from the moment it got there — so scrolling up to the top and continuing
  // to pull down closes the sheet.
  const scrollY = useRef(0);
  const dragBase = useRef<number | null>(0);
  const dragGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetY([-8, 8])
        .failOffsetX([-24, 24])
        .onStart(() => {
          dragBase.current = scrollY.current <= 1 ? 0 : null;
        })
        .onUpdate((e) => {
          if (scrollY.current > 1) {
            dragBase.current = null;
            translateY.setValue(0);
            return;
          }
          if (dragBase.current === null) dragBase.current = e.translationY;
          translateY.setValue(Math.max(0, e.translationY - dragBase.current));
        })
        .onEnd((e) => {
          const dist = dragBase.current === null ? 0 : e.translationY - dragBase.current;
          dragBase.current = 0;
          if (dist > 120 || (dist > 24 && e.velocityY > 800)) {
            closeSheet();
          } else {
            Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
          }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const scrollCtx = useMemo<SheetScrollCtx>(
    () => ({ pan: dragGesture, onScroll: (y) => (scrollY.current = y) }),
    [dragGesture]
  );

  // Stays mounted after `visible` goes false until the slide-out finishes, so
  // a sheet closed from outside (e.g. picking a page in the More sheet)
  // animates away instead of vanishing in one frame.
  const [mounted, setMounted] = useState(visible);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      scrollY.current = 0;
      translateY.setValue(1000);
      Animated.timing(translateY, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    } else {
      Animated.timing(translateY, { toValue: 1000, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, translateY]);

  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const show = Keyboard.addListener("keyboardDidShow", (e) => setKeyboardHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
      setKeyboardHeight(0);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      closeRef.current();
      return true;
    });
    return () => sub.remove();
  }, [visible]);

  useEffect(() => {
    if (!mounted) {
      sheetStore.remove(id);
      return;
    }
    sheetStore.set(
      id,
      // No touches while sliding out, so taps land on the page underneath.
      <View style={styles.overlay} pointerEvents={visible ? "box-none" : "none"}>
        {/* Backdrop dims in step with the sheet's position, so a drag or close
            fades it out instead of it vanishing in one frame at unmount. */}
        <Animated.View style={[StyleSheet.absoluteFill, bare ? styles.backdropBare : styles.backdrop, { opacity: backdropOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeSheet} />
        </Animated.View>
        {(() => {
          const sheet = (
            <Animated.View
              style={[
                bare ? styles.sheetBare : styles.sheet,
                {
                  maxHeight: `${maxHeightPct}%`,
                  marginBottom: keyboardHeight,
                  paddingBottom: bare ? (keyboardHeight ? 0 : insets.bottom) : keyboardHeight ? 14 : 14 + Math.max(insets.bottom, 10),
                  transform: [{ translateY }],
                },
              ]}
            >
              <View style={bare ? styles.handleWrapBare : styles.handleWrap}>
                <View style={bare ? styles.handleBare : styles.handle} />
              </View>
              <SheetScrollContext.Provider value={dragToClose ? scrollCtx : null}>{children}</SheetScrollContext.Provider>
            </Animated.View>
          );
          return dragToClose ? <GestureDetector gesture={dragGesture}>{sheet}</GestureDetector> : sheet;
        })()}
      </View>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, visible, maxHeightPct, keyboardHeight, insets.bottom, children, dragGesture, dragToClose, scrollCtx, bare]);

  useEffect(() => () => sheetStore.remove(id), [id]);

  return null;
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: "rgba(0,0,0,0.4)" },
  // prototype .modal-backdrop
  backdropBare: { backgroundColor: "rgba(10,8,20,0.48)" },
  // prototype .modal-card.sheet-bottom
  sheetBare: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
    boxShadow: "0px 24px 60px rgba(0,0,0,0.35)",
  },
  // prototype .sheet-handle-area / .sheet-handle
  handleWrapBare: { paddingTop: 10, paddingBottom: 2, alignItems: "center" },
  handleBare: { width: 36, height: 4, borderRadius: 99, backgroundColor: colors.line },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingHorizontal: 20,
  },
  handleWrap: {
    paddingVertical: 8,
    marginBottom: 4,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.line,
  },
});
