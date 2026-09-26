import React, { useEffect, useRef, useState } from "react";
import { Animated, BackHandler, Easing, Keyboard, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheetModal, SheetScrollView } from "../BottomSheetModal";
import { nextSheetId, sheetStore } from "../SheetHost";
import { C, Txt } from "./base";

/** .modal-head — title, spacer, "Close". */
export function ModalHead({ title, onClose, closeLabel = "Close", children }: { title?: React.ReactNode; onClose: () => void; closeLabel?: string; children?: React.ReactNode }) {
  return (
    <View style={s.head}>
      {children ?? (
        <>
          {typeof title === "string" ? (
            <Txt style={s.headTitle} numberOfLines={1}>
              {title}
            </Txt>
          ) : (
            title
          )}
          <View style={{ flex: 1 }} />
        </>
      )}
      <Pressable onPress={onClose} hitSlop={10}>
        <Txt style={s.cancel}>{closeLabel}</Txt>
      </Pressable>
    </View>
  );
}

/** Rise-up bottom sheet (.modal-card.sheet-bottom): handle, head, scrolling
 * body. Pass `scroll={false}` when the body supplies its own SheetFlatList
 * (paged lists inside a sheet). */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  maxHeightPct = 80,
  scroll = true,
  bodyStyle,
  headExtra,
}: {
  visible: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  maxHeightPct?: number;
  scroll?: boolean;
  bodyStyle?: StyleProp<ViewStyle>;
  /** Rendered between the head and the body (e.g. filter chips, tabs). */
  headExtra?: React.ReactNode;
}) {
  return (
    <BottomSheetModal visible={visible} onClose={onClose} maxHeightPct={maxHeightPct} bare>
      <ModalHead title={title} onClose={onClose} />
      {headExtra}
      {scroll ? (
        <SheetScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={[s.body, bodyStyle]}>
          {children}
        </SheetScrollView>
      ) : (
        <View style={[{ flexShrink: 1 }, bodyStyle]}>{children}</View>
      )}
    </BottomSheetModal>
  );
}

/** Shared overlay for the centre and top-slide modals (not draggable). */
function useOverlay(visible: boolean, onClose: () => void, render: (anim: Animated.Value) => React.ReactNode, deps: unknown[]) {
  const anim = useRef(new Animated.Value(0)).current;
  const idRef = useRef<string>(undefined as unknown as string);
  if (!idRef.current) idRef.current = nextSheetId();
  const [mounted, setMounted] = useState(visible);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(anim, { toValue: 1, duration: 300, easing: Easing.bezier(0.32, 0.72, 0, 1), useNativeDriver: true }).start();
    } else {
      Keyboard.dismiss();
      Animated.timing(anim, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, anim]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      closeRef.current();
      return true;
    });
    return () => sub.remove();
  }, [visible]);

  useEffect(() => {
    const id = idRef.current;
    if (!mounted) {
      sheetStore.remove(id);
      return;
    }
    sheetStore.set(id, render(anim));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, visible, ...deps]);

  useEffect(() => () => sheetStore.remove(idRef.current), []);
}

/** .modal-backdrop.center-modal + .modal-card.floating (Gold Rate). */
export function CenterModal({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode }) {
  useOverlay(
    visible,
    onClose,
    (anim) => (
      <View style={s.overlayCenter} pointerEvents={visible ? "auto" : "none"}>
        <Animated.View style={[StyleSheet.absoluteFill, s.backdrop, { opacity: anim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={[
            s.floatingCard,
            { opacity: anim, transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] },
          ]}
        >
          <ModalHead title={title} onClose={onClose} />
          {children}
        </Animated.View>
      </View>
    ),
    [children, title]
  );
  return null;
}

/** .modal-backdrop.top-modal + .modal-card.top-slide (global search). */
export function TopModal({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  useOverlay(
    visible,
    onClose,
    (anim) => (
      <View style={StyleSheet.absoluteFill} pointerEvents={visible ? "auto" : "none"}>
        <Animated.View style={[StyleSheet.absoluteFill, s.backdrop, { opacity: anim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={[
            s.topCard,
            { paddingTop: insets.top },
            { transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-700, 0] }) }] },
          ]}
        >
          {children}
        </Animated.View>
      </View>
    ),
    [children, insets.top]
  );
  return null;
}

const s = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  headTitle: { fontWeight: "700", fontSize: 15, flexShrink: 1 },
  cancel: { fontSize: 13, fontWeight: "700", color: C.brandDeep },
  // .modal-body
  body: { paddingTop: 6, paddingHorizontal: 16, paddingBottom: 28 },
  backdrop: { backgroundColor: "rgba(10,8,20,0.48)" },
  overlayCenter: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  floatingCard: {
    width: "100%",
    maxHeight: "76%",
    backgroundColor: C.card,
    borderRadius: 22,
    overflow: "hidden",
    boxShadow: "0px 24px 60px rgba(0,0,0,0.35)",
  },
  topCard: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    maxHeight: "78%",
    backgroundColor: C.card,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    overflow: "hidden",
    boxShadow: "0px 18px 40px rgba(0,0,0,0.3)",
  },
});
