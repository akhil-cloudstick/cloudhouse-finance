import React, { useEffect, useRef, useState } from "react";
import { Animated, BackHandler, Keyboard, PanResponder, Pressable, View, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme/colors";
import { nextSheetId, sheetStore } from "./SheetHost";

// Shared "rises up from the bottom" sheet used by every modal in the app
// (Add Reminder, Reports preview, Purity Standards, Add Bank, More menu, ...) —
// closes on a tap outside the sheet OR a downward swipe on the sheet itself.
//
// This renders NOTHING in place. It publishes its overlay into SheetHost
// (see SheetHost.tsx), which is mounted once as a sibling of <Slot/> in the
// root layout's own full-screen view. A native <Modal> can't be used here:
// the app draws edge-to-edge and the modal's separate window is laid out
// inside the system-bar insets, so `bottom: 0` landed above the navigation /
// gesture bar and left a strip of dimmed page showing under the sheet.
// Rendering into the app's own root view means `bottom: 0` is the real
// bottom edge.
export function BottomSheetModal({
  visible,
  onClose,
  children,
  maxHeightPct = 88,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxHeightPct?: number;
}) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(0)).current;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const idRef = useRef<string | undefined>(undefined);
  if (!idRef.current) idRef.current = nextSheetId();
  const id = idRef.current;

  const panResponder = useRef(
    PanResponder.create({
      // Claiming the touch on START is what stops a tap on the sheet's own
      // background from bubbling to the overlay Pressable and closing it —
      // the job the old no-op <Pressable> wrapper did. Children still win
      // (this isn't a *Capture* handler), so rows and buttons inside the
      // sheet keep working; a plain tap here just springs back to dy 0.
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 120 || g.vy > 0.8) {
          Animated.timing(translateY, { toValue: 800, duration: 180, useNativeDriver: true }).start(() => {
            translateY.setValue(0);
            closeRef.current();
          });
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
        }
      },
    })
  ).current;

  useEffect(() => {
    if (!visible) return;
    translateY.setValue(600);
    Animated.timing(translateY, { toValue: 0, duration: 220, useNativeDriver: true }).start();
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

  // Publish/withdraw the overlay. Runs on every render while open so the
  // sheet's children stay live; sheetStore lives outside React, so this
  // re-renders only SheetHost and can't loop back into this component.
  useEffect(() => {
    if (!visible) {
      sheetStore.remove(id);
      return;
    }
    sheetStore.set(
      id,
      <Pressable style={styles.overlay} onPress={() => closeRef.current()}>
        <Animated.View
          style={[
            styles.sheet,
            {
              maxHeight: `${maxHeightPct}%`,
              marginBottom: keyboardHeight,
              paddingBottom: keyboardHeight ? 14 : 14 + Math.max(insets.bottom, 10),
              transform: [{ translateY }],
            },
          ]}
          {...panResponder.panHandlers}
        >
          <View style={styles.handle} />
          {children}
        </Animated.View>
      </Pressable>
    );
  });

  // Unmounting the owner (navigating away with a sheet open) must not leave
  // an orphaned overlay behind in the host.
  useEffect(() => () => sheetStore.remove(id), [id]);

  return null;
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
    // The sheet is bottom-aligned by flex, NOT by an intermediate
    // absolutely-positioned wrapper. That wrapper (bottom/left/right, no
    // top) had an AUTO height, so the sheet's `maxHeight: '88%'` was a
    // percentage of an indefinite parent — Yoga can't resolve that (parent
    // sized by child, child sized by parent) and the sheet came out short,
    // leaving a strip of dimmed page visible below it. This overlay has a
    // definite full-screen height, so the percentage resolves and `flex-end`
    // puts the sheet flush against the real bottom edge.
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.ivory,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingHorizontal: 20,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.line,
    marginBottom: 12,
  },
});
