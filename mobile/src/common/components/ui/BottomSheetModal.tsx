import React, { createContext, useEffect, useMemo, useRef, useState } from "react";
import { Animated, BackHandler, Easing, Keyboard, LayoutAnimation, Platform, Pressable, View, StyleSheet, useWindowDimensions, type KeyboardEvent } from "react-native";
import { Gesture, GestureDetector, type PanGesture } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "@/common/theme/colors";
import { nextSheetId, sheetStore } from "./SheetHost";
import { notifyLayoutShift } from "./Popover";

// Locks inner scrollers while the sheet is dragging, to stop the list and sheet fighting each other.
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

let fullOverlayH = 0;

type BottomSheetModalProps = {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxHeightPct?: number;
  dragToClose?: boolean;
  /** Prototype sheet styling (.modal-card.sheet-bottom): no side padding, content lays out its own head/body. */
  bare?: boolean;
};

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
  // Slide distance = the sheet's measured height, not a fixed value, so the whole animation stays on screen.
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

  // Guards against a second touch during slide-out starting a fresh drag that springs the sheet back open.
  const closing = useRef(false);
  const [scrollLock] = useState(createScrollLock);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const closeSheet = () => {
    closing.current = true;
    scrollLock.set(true);
    // No reset to 0 here, to avoid a flash of the sheet snapping back before unmount.
    Animated.timing(translateY, { toValue: offscreen(), duration: CLOSE_MS, easing: CLOSE_EASE, useNativeDriver: true }).start(() => {
      closeRef.current();
      // If onClose declines to close, bring the sheet back instead of leaving it parked off-screen.
      setTimeout(() => {
        if (!visibleRef.current || !closing.current) return;
        closing.current = false;
        scrollLock.set(false);
        Animated.spring(translateY, { toValue: 0, ...OPEN_SPRING, useNativeDriver: true }).start();
      }, 0);
    });
  };

  // Sheet only follows the finger once the inner list is scrolled to its top.
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
          // Take over from any in-flight open/spring-back animation.
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
          // Hands back to the list only once the finger returns above where the pull began, to avoid a stutter.
          if (d <= 0) {
            translateY.setValue(0);
            scrollLock.set(false);
            if (scrollY.current > 1) dragBase.current = null;
            return;
          }
          scrollLock.set(true);
          translateY.setValue(d);
        })
        .onEnd((e) => {
          if (closing.current) return;
          const dist = dragBase.current === null ? 0 : e.translationY - dragBase.current;
          dragBase.current = 0;
          if (dist > Math.min(120, sheetH.current * 0.25) || (dist > 24 && e.velocityY > 600)) {
            closeSheet();
          } else {
            Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
          }
        })
        .onFinalize(() => {
          if (!closing.current) scrollLock.set(false);
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const scrollCtx = useMemo<SheetScrollCtx>(
    () => ({ pan: dragGesture, onScroll: (y) => (scrollY.current = y), lock: scrollLock }),
    [dragGesture, scrollLock]
  );

  // Stays mounted after `visible` goes false until slide-out finishes, so closing animates instead of vanishing.
  const [mounted, setMounted] = useState(visible);
  const mountedRef = useRef(false);
  // Opening waits for the sheet's first layout so the slide starts from its real height.
  const pendingOpen = useRef(false);
  // While sliding, Android caches the sheet as one layer to avoid dropped frames on content-heavy sheets.
  const [moving, setMoving] = useState(false);
  const runOpen = () => {
    pendingOpen.current = false;
    setMoving(true);
    Animated.spring(translateY, { toValue: 0, ...OPEN_SPRING, useNativeDriver: true }).start(() => setMoving(false));
  };
  useEffect(() => {
    if (visible) {
      setMounted(true);
      closing.current = false;
      scrollLock.set(false);
      scrollY.current = 0;
      if (mountedRef.current) {
        runOpen();
      } else {
        translateY.setValue(offscreen());
        pendingOpen.current = true;
        // Safety net in case the layout event is missed.
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
  // Some Android devices resize the window for the keyboard; lifting by the full keyboard height there would
  // double-count it, so the lift is reduced by however much the overlay has already shrunk.
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
    // iOS: follow the keyboard as it animates instead of jumping once it finishes.
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
                  // Cap height to the space left above the lifted sheet, else the top gets pushed off-screen.
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

const OPEN_SPRING = { damping: 30, stiffness: 260, mass: 1, overshootClamping: true, restDisplacementThreshold: 0.5, restSpeedThreshold: 0.5 };
const CLOSE_MS = 240;
const KB_GAP = 4;
const CLOSE_EASE = Easing.bezier(0.4, 0, 0.9, 0.6);

const styles = StyleSheet.create({
  backdrop: { backgroundColor: "rgba(0,0,0,0.4)" },
  backdropBare: { backgroundColor: "rgba(10,8,20,0.48)" },
  sheetBare: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
    boxShadow: "0px 24px 60px rgba(0,0,0,0.35)",
  },
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
