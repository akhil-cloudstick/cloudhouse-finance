import React, { useRef } from "react";
import { Modal, Animated, PanResponder, Pressable, View, StyleSheet } from "react-native";
import { colors } from "../theme/colors";

// Shared "rises up from the bottom" sheet used by every modal in the app
// (Add Reminder, Reports preview, Purity Standards, Add Bank, ...) —
// closes on a tap outside the sheet OR a downward swipe on the sheet
// itself, so every modal in the app behaves the same way instead of each
// screen reinventing its own Modal+View plumbing.
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
  const translateY = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      // Only claim the gesture once it's clearly a vertical drag — lets
      // taps/scrolls on the sheet's own content (inputs, ScrollViews)
      // through untouched.
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 120 || g.vy > 0.8) {
          Animated.timing(translateY, { toValue: 800, duration: 180, useNativeDriver: true }).start(() => {
            translateY.setValue(0);
            onClose();
          });
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
        }
      },
    })
  ).current;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Backdrop — tapping anywhere outside the sheet closes it. */}
      <Pressable style={styles.overlay} onPress={onClose}>
        {/* No-op Pressable: stops the backdrop's onPress from firing when
            the tap lands on the sheet's own (non-interactive) padding. */}
        <Pressable onPress={() => {}} style={styles.sheetWrap}>
          <Animated.View
            style={[styles.sheet, { maxHeight: `${maxHeightPct}%`, transform: [{ translateY }] }]}
            {...panResponder.panHandlers}
          >
            <View style={styles.handle} />
            {children}
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheetWrap: { width: "100%" },
  sheet: {
    backgroundColor: colors.ivory,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingHorizontal: 20,
    paddingBottom: 20,
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
