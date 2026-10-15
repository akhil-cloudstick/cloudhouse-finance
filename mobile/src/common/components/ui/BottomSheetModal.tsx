import React, { createContext, useEffect, useMemo, useRef, useState } from "react";
import { Animated, BackHandler, Easing, Keyboard, LayoutAnimation, Platform, Pressable, View, StyleSheet, useWindowDimensions, type KeyboardEvent } from "react-native";
import { Gesture, GestureDetector, type PanGesture } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "@/common/theme/colors";
import { nextSheetId, sheetStore } from "./SheetHost";
import { notifyLayoutShift } from "./Popover";

// Whether the sheet itself is being pulled down / sliding shut. While it is,
// the scroller inside is held still: the list used to keep scrolling under
// the same finger (and carry on with momentum after the release) while the
// sheet moved, the two fighting each other as a jitter. A tiny store so only
// the scrollers re-render when it flips.
export type ScrollLock = { get: () => boolean; set: (v: boolean) => void; subscribe: (l: () => void) => () => void };
function createScrollLock(): ScrollLock {
  let locked = false;
  const listeners = new Set<() => void>();
  return {
    get: () => locked,
    set: (v) => {
      if (locked === v) return;
      locked = v;
      listeners.forEach((l) => l());
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

type SheetScrollCtx = { pan: PanGesture; onScroll: (y: number) => void; lock: ScrollLock };
export const SheetScrollContext = createContext<SheetScrollCtx | null>(null);

// Tallest overlay height seen (the full window) — see the keyboard lift below.
let fullOverlayH = 0;

type BottomSheetModalProps = {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxHeightPct?: number;
  dragToClose?: boolean;
  /** Prototype sheet styling (.modal-card.sheet-bottom): white card, 24
   * radius, no side padding — the content lays out its own head/body. */
  bare?: boolean;
};

// Shared "rises up from the bottom" sheet, publishing into SheetHost rather than
// rendering a native Modal (see SheetHost.tsx's doc comment).
export function BottomSheetModal({
  visible,
  onClose,
  children,
  maxHeightPct = 88,
  dragToClose = true,
  bare = false,
}: BottomSheetModalProps) {
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const translateY = useRef(new Animated.Value(0)).current;
  // Slide distance = the sheet's own measured height (not a fixed 1000px),
  // so the whole animation is spent on screen instead of partly off it —
  // that dead time is what made short sheets look like they paused, then
  // snapped. The backdrop fades over the same distance.
  const sheetH = useRef(win.height);
  const travel = useRef(new Animated.Value(win.height)).current;
  const backdropOpacity = useRef(
    Animated.divide(translateY, travel).interpolate({ inputRange: [0, 1], outputRange: [1, 0], extrapolate: "clamp" })
  ).current;
  const offscreen = () => sheetH.current + 24;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const idRef = useRef<string | undefined>(undefined);
  if (!idRef.current) idRef.current = nextSheetId();
  const id = idRef.current;

  // Set once a drag has committed to closing: a second touch landing during
  // the slide-out used to start a fresh drag, whose setValue stopped the
  // close mid-way and whose short distance then sprang the sheet back open.
  const closing = useRef(false);
  const [scrollLock] = useState(createScrollLock);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const closeSheet = () => {
    closing.current = true;
    scrollLock.set(true);
    // No reset to 0 here — that snapped the sheet back on-screen for a frame
    // before it unmounted (the flash). The open effect re-positions it.
    Animated.timing(translateY, { toValue: offscreen(), duration: CLOSE_MS, easing: CLOSE_EASE, useNativeDriver: true }).start(() => {
      closeRef.current();
      // An onClose that declines to close (e.g. a form mid-save) left the
      // sheet parked off-screen but still mounted — an invisible overlay
      // over the page. Bring it back instead.
      setTimeout(() => {
        if (!visibleRef.current || !closing.current) return;
        closing.current = false;
        scrollLock.set(false);
        Animated.spring(translateY, { toValue: 0, ...OPEN_SPRING, useNativeDriver: true }).start();
      }, 0);
    });
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
          if (closing.current) return;
          // Take over from an open/spring-back still in flight rather than
          // fighting it frame by frame.
          translateY.stopAnimation();
          dragBase.current = scrollY.current <= 1 ? 0 : null;
        })
        .onUpdate((e) => {
          if (closing.current) return;
          if (dragBase.current === null) {
            if (scrollY.current > 1) return;
            dragBase.current = e.translationY;
          }
          const d = e.translationY - dragBase.current;
          // Once the sheet has been pulled down it keeps following the
          // finger. It used to snap to 0 the moment the inner list reported
          // any scroll offset — which it can mid-drag, a frame late — and
          // that snap-then-follow was the visible stutter. It only hands
          // back to the list once the finger returns above where the pull
          // began.
          if (d <= 0) {
            translateY.setValue(0);
            scrollLock.set(false);
            if (scrollY.current > 1) dragBase.current = null;
            return;
          }
          // The sheet is moving: hold the list still under the finger.
          scrollLock.set(true);
          translateY.setValue(d);
        })
        .onEnd((e) => {
          if (closing.current) return;
          const dist = dragBase.current === null ? 0 : e.translationY - dragBase.current;
          dragBase.current = 0;
          // A quarter of a short sheet's height is enough; a tall one still
          // needs the fixed 120.
          if (dist > Math.min(120, sheetH.current * 0.25) || (dist > 24 && e.velocityY > 600)) {
            closeSheet();
          } else {
            Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
          }
        })
        .onFinalize(() => {
          // Released or cancelled without closing: the list is free again.
          if (!closing.current) scrollLock.set(false);
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const scrollCtx = useMemo<SheetScrollCtx>(
    () => ({ pan: dragGesture, onScroll: (y) => (scrollY.current = y), lock: scrollLock }),
    [dragGesture, scrollLock]
  );

  // Stays mounted after `visible` goes false until the slide-out finishes, so
  // a sheet closed from outside (e.g. picking a page in the More sheet)
  // animates away instead of vanishing in one frame.
  const [mounted, setMounted] = useState(visible);
  const mountedRef = useRef(false);
  // Opening waits for the sheet's first layout, so the slide starts from
  // exactly its own height and only after the content has been laid out
  // (starting in the same frame as the mount dropped the first frames).
  const pendingOpen = useRef(false);
  // While sliding, Android draws the sheet as one cached layer instead of
  // re-rasterising every row each frame (the main source of dropped frames
  // on content-heavy sheets).
  const [moving, setMoving] = useState(false);
  const runOpen = () => {
    pendingOpen.current = false;
    setMoving(true);
    // A critically-damped spring eases in more naturally than a fixed-time
    // curve and never overshoots.
    Animated.spring(translateY, { toValue: 0, ...OPEN_SPRING, useNativeDriver: true }).start(() => setMoving(false));
  };
  useEffect(() => {
    if (visible) {
      setMounted(true);
      closing.current = false;
      scrollLock.set(false);
      scrollY.current = 0;
      if (mountedRef.current) {
        // Re-opened while still sliding out: reverse from where it is.
        runOpen();
      } else {
        translateY.setValue(offscreen());
        pendingOpen.current = true;
        // Safety net: never leave the sheet parked off-screen if a layout
        // event is somehow missed.
        setTimeout(() => pendingOpen.current && runOpen(), 150);
      }
      mountedRef.current = true;
    } else {
      pendingOpen.current = false;
      setMoving(true);
      Animated.timing(translateY, { toValue: offscreen(), duration: CLOSE_MS, easing: CLOSE_EASE, useNativeDriver: true }).start(({ finished }) => {
        setMoving(false);
        if (finished) {
          mountedRef.current = false;
          setMounted(false);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, translateY]);
  const onSheetLayout = (h: number) => {
    if (h <= 0) return;
    notifyLayoutShift();
    sheetH.current = h;
    travel.setValue(h + 24);
    if (pendingOpen.current) {
      translateY.setValue(h + 24);
      runOpen();
    }
  };

  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // Some Android devices resize the whole window for the keyboard (the
  // overlay shrinks by the keyboard's height); others draw edge-to-edge and
  // leave it full height. Lifting the sheet by the full keyboard height on a
  // resized window counted it twice, pushing the sheet (and its dropdowns)
  // far up the screen. So measure the overlay: its tallest measured height
  // is the full window (the app is portrait-only); whatever it has shrunk by
  // since comes off the lift. (The resize can land before the keyboard
  // event, hence the running max rather than "height while keyboard down".)
  const [overlayH, setOverlayH] = useState(0);
  const onOverlayLayout = (h: number) => {
    fullOverlayH = Math.max(fullOverlayH, h);
    setOverlayH(h);
  };
  const fullH = { current: fullOverlayH };
  const resizedBy = keyboardHeight && overlayH ? Math.max(0, fullOverlayH - overlayH) : 0;
  const lift = Math.max(0, keyboardHeight - resizedBy);
  const availH = overlayH || win.height;
  useEffect(() => {
    if (!visible) return;
    // iOS: follow the keyboard as it moves (Will events + the keyboard's own
    // curve) instead of jumping once it has finished animating.
    const ios = Platform.OS === "ios";
    const animate = (e: KeyboardEvent) => {
      if (ios && e.duration) LayoutAnimation.configureNext({ duration: e.duration, update: { type: LayoutAnimation.Types.keyboard } });
    };
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (e) => {
      animate(e);
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", (e) => {
      animate(e);
      setKeyboardHeight(0);
    });
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
      <View style={styles.overlay} pointerEvents={visible ? "box-none" : "none"} onLayout={(e) => onOverlayLayout(e.nativeEvent.layout.height)}>
        {/* Backdrop dims in step with the sheet's position, so a drag or close
            fades it out instead of it vanishing in one frame at unmount. */}
        <Animated.View style={[StyleSheet.absoluteFill, bare ? styles.backdropBare : styles.backdrop, { opacity: backdropOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeSheet} />
        </Animated.View>
        {(() => {
          const sheet = (
            <Animated.View
              onLayout={(e) => onSheetLayout(e.nativeEvent.layout.height)}
              renderToHardwareTextureAndroid={moving}
              shouldRasterizeIOS={moving}
              style={[
                bare ? styles.sheetBare : styles.sheet,
                {
                  // With the keyboard up the sheet is lifted by its height, so
                  // cap it to the space left above it — otherwise its top (and
                  // the focused field) is pushed off the top of the screen.
                  maxHeight: keyboardHeight
                    ? Math.min((fullH.current * maxHeightPct) / 100 || Infinity, availH - lift - insets.top - 8)
                    : `${maxHeightPct}%`,
                  marginBottom: lift,
                  paddingBottom: bare ? (keyboardHeight ? KB_GAP : insets.bottom) : keyboardHeight ? 14 : 14 + Math.max(insets.bottom, 10),
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
  }, [mounted, visible, moving, maxHeightPct, keyboardHeight, lift, availH, insets.bottom, insets.top, win.height, children, dragGesture, dragToClose, scrollCtx, bare]);

  useEffect(() => () => sheetStore.remove(id), [id]);

  return null;
}

// iOS-style sheet curves: a long, soft deceleration in; a quick ease out.
const OPEN_SPRING = { damping: 30, stiffness: 260, mass: 1, overshootClamping: true, restDisplacementThreshold: 0.5, restSpeedThreshold: 0.5 };
const CLOSE_MS = 240;
// Clear space kept between a sheet footer and the keyboard top (added to the footer's own 12px padding).
const KB_GAP = 4;
const CLOSE_EASE = Easing.bezier(0.4, 0, 0.9, 0.6);

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
