import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, BackHandler, Keyboard, Pressable, View, StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme/colors";
import { nextSheetId, sheetStore } from "./SheetHost";

// Shared "rises up from the bottom" sheet, publishing into SheetHost rather than
// rendering a native Modal (see SheetHost.tsx's doc comment).
export function BottomSheetModal({
  visible,
  onClose,
  children,
  maxHeightPct = 88,
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

  const closeSheet = () => {
    Animated.timing(translateY, { toValue: 800, duration: 180, useNativeDriver: true }).start(() => {
      translateY.setValue(0);
      closeRef.current();
    });
  };

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
