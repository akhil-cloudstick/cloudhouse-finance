import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, BackHandler, Keyboard, Pressable, View, StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme/colors";
import { nextSheetId, sheetStore } from "./SheetHost";

// Ported from mobile/src/components/BottomSheetModal.tsx — the shared
// "rises up from the bottom" sheet, publishing into SheetHost rather than
// rendering a native Modal (see sheetHost.tsx's doc comment).
export function BottomSheetModal({
  visible,
  onClose,
  children,
  maxHeightPct = 88,
  // Off for NotificationList (see app/(tabs)/index.tsx etc.) — every attempt
  // to scope the drag-to-close gesture away from a scrollable child
  // (PanResponder, then a react-native-gesture-handler Gesture.Pan limited
  // to just the handle bar) still left the FlatList's own scroll dying
  // after one gesture, which points at the two native gesture systems
  // fighting over the touch stream rather than at how the pan gesture was
  // scoped. Removing the competing recognizer entirely for that sheet is
  // the one thing guaranteed to end the conflict — closing still works via
  // the backdrop tap and the hardware back button either way.
  dragToClose = true,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxHeightPct?: number;
  dragToClose?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(0)).current;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const idRef = useRef<string | undefined>(undefined);
  if (!idRef.current) idRef.current = nextSheetId();
  const id = idRef.current;

  // A react-native-gesture-handler Gesture rather than the legacy
  // PanResponder API — expo-router/React Navigation already installs
  // gesture-handler's native touch dispatcher app-wide, and a plain
  // PanResponder mixed into that context is known to misnegotiate against
  // native-gesture-handler-managed scrollables (it can end up claiming
  // moves that start well outside the view it's attached to, e.g. inside
  // NotificationList's FlatList several views away), which is what made
  // scrolling the list close the sheet instead. Scoped with a
  // GestureDetector around only the handle bar below, same as the old
  // PanResponder's intent, but negotiated through the same native system
  // the FlatList itself uses.
  const closeSheet = () => {
    Animated.timing(translateY, { toValue: 800, duration: 180, useNativeDriver: true }).start(() => {
      translateY.setValue(0);
      closeRef.current();
    });
  };

  // Memoized — a fresh Gesture instance handed to GestureDetector on every
  // render makes gesture-handler tear down and rebuild the native
  // recognizer each time. Combined with the sheetStore-publish effect below
  // previously having no dependency array (so it fired on every render, of
  // which there are plenty once notifications are streaming in), that
  // teardown/rebuild cycle could land mid-gesture against the sibling
  // FlatList's own native scroll responder — the likely cause of scrolling
  // working once and then going dead.
  const dragGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .onUpdate((e) => {
          if (e.translationY > 0) translateY.setValue(e.translationY);
        })
        .onEnd((e) => {
          if (e.translationY > 120 || e.velocityY > 800) {
            closeSheet();
          } else {
            Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
          }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

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

  useEffect(() => {
    if (!visible) {
      sheetStore.remove(id);
      return;
    }
    sheetStore.set(
      id,
      // The backdrop is an absolutely-positioned sibling BEHIND the sheet,
      // not a Pressable wrapping it. Previously the sheet — and therefore
      // any scrollable inside `children` — was a descendant of the backdrop
      // Pressable, so every touch on the list also entered that Pressable's
      // responder negotiation on its way down. A Pressable ancestor can
      // claim or cancel the responder mid-gesture, which is exactly the kind
      // of state that survives badly across a scroll ending at the content
      // edge. Nothing above the list competes for touches now.
      <View style={styles.overlay} pointerEvents="box-none">
        <Pressable style={StyleSheet.absoluteFill} onPress={() => closeRef.current()} />
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
        >
          {dragToClose ? (
            <GestureDetector gesture={dragGesture}>
              <View style={styles.handleWrap}>
                <View style={styles.handle} />
              </View>
            </GestureDetector>
          ) : (
            <View style={styles.handleWrap}>
              <View style={styles.handle} />
            </View>
          )}
          {children}
        </Animated.View>
      </View>
    );
    // No dependency array here previously — this ran after every render of
    // BottomSheetModal, republishing a brand-new element tree (new
    // Pressable, Animated.View, GestureDetector) each time, which is what
    // let dragGesture get rebuilt mid-session before it was memoized above.
    // Scoped now to the values the published node actually depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, maxHeightPct, keyboardHeight, insets.bottom, children, dragGesture, dragToClose]);

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
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.ivory,
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
