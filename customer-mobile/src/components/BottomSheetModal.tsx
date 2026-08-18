import React, { useEffect, useRef, useState } from "react";
import { Animated, BackHandler, Keyboard, PanResponder, Pressable, View, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme/colors";
import { nextSheetId, sheetStore } from "./sheetHost";

// Ported from mobile/src/components/BottomSheetModal.tsx — the shared
// "rises up from the bottom" sheet, publishing into SheetHost rather than
// rendering a native Modal (see sheetHost.tsx's doc comment).
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
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.line,
    marginBottom: 12,
  },
});
