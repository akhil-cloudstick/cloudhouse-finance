import React, { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Animated, BackHandler, Easing, Keyboard, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheetModal, SheetScrollView } from "../BottomSheetModal";
import { nextSheetId, sheetStore } from "../SheetHost";
import { C, Txt } from "./base";
import { HeroBackground } from "./Shell";
import { takeOverlayOrigin, type OverlayOrigin } from "./overlayOrigin";

/** .modal-head — title, spacer, "Close". */
export function ModalHead({ title, onClose, closeLabel = "Close", hideClose, children }: { title?: React.ReactNode; onClose: () => void; closeLabel?: string; hideClose?: boolean; children?: React.ReactNode }) {
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
      {hideClose ? null : (
        <Pressable onPress={onClose} hitSlop={10}>
          <Txt style={s.cancel}>{closeLabel}</Txt>
        </Pressable>
      )}
    </View>
  );
}

// ---- footer slot ----------------------------------------------------------
// Lets a component nested deep inside a sheet (e.g. a review panel) put its
// action buttons in that sheet's sticky footer: <SheetFooter> publishes into
// a tiny per-sheet store that only the footer slot subscribes to, so the
// publish never re-renders the sheet body (no update loop).
type Slot = { get: () => React.ReactNode; set: (n: React.ReactNode) => void; subscribe: (l: () => void) => () => void };
const SlotContext = createContext<Slot | null>(null);

function createSlot(): Slot {
  let node: React.ReactNode = null;
  const listeners = new Set<() => void>();
  return {
    get: () => node,
    set: (n) => {
      node = n;
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

function FooterSlot({ slot, auto }: { slot: Slot; auto: React.ReactNode[] }) {
  const node = useSyncExternalStore(slot.subscribe, slot.get);
  if (!node && !auto.length) return null;
  return (
    <View style={s.footer}>
      {node}
      {auto}
    </View>
  );
}

/** Renders its children in the enclosing Sheet's sticky footer (or inline
 * when not inside a Sheet). */
export function SheetFooter({ children }: { children: React.ReactNode }) {
  const slot = useContext(SlotContext);
  useEffect(() => {
    slot?.set(children);
  });
  useEffect(() => () => slot?.set(null), [slot]);
  return slot ? null : <>{children}</>;
}

/** Components that mark themselves footer-able (PrimaryButton, BtnRow2) —
 * set as a static flag to avoid a Sheet ⇄ Form import cycle. */
type FooterFlag = { stickyFooter?: boolean };

/** Splits trailing footer-able elements (the sheet's action buttons) off the
 * end of the body so they can sit in a sticky footer. Fragments are
 * flattened; falsy children are ignored. */
function splitFooter(children: React.ReactNode): {
  body: React.ReactNode[];
  footer: React.ReactNode[];
} {
  const flat: React.ReactNode[] = [];
  // Children.toArray keys restart at ".0" inside every fragment, so once
  // nested fragments are flattened into one list their keys collide
  // (React's duplicate-key error). Prefix each key with its fragment path.
  const walk = (nodes: React.ReactNode, path: string) =>
    React.Children.toArray(nodes).forEach((n) => {
      if (React.isValidElement(n) && n.type === React.Fragment) walk((n.props as { children?: React.ReactNode }).children, `${path}${String(n.key)}/`);
      else if (React.isValidElement(n)) flat.push(path ? React.cloneElement(n, { key: `${path}${String(n.key)}` }) : n);
      else flat.push(n);
    });
  walk(children, "");
  let cut = flat.length;
  while (cut > 0) {
    const n = flat[cut - 1];
    if (React.isValidElement(n) && (n.type as FooterFlag).stickyFooter) cut--;
    else break;
  }
  return { body: flat.slice(0, cut), footer: flat.slice(cut) };
}

/** Rise-up bottom sheet (.modal-card.sheet-bottom): handle, head, scrolling
 * body, and a sticky footer holding the sheet's trailing action button(s)
 * so they stay reachable however long the form is. Pass `scroll={false}`
 * when the body supplies its own SheetFlatList (paged lists inside a sheet),
 * or `stickyFooter={false}` to keep the buttons in the scroll. */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  maxHeightPct = 80,
  scroll = true,
  bodyStyle,
  headExtra,
  stickyFooter = true,
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
  stickyFooter?: boolean;
}) {
  const { body, footer } = scroll && stickyFooter ? splitFooter(children) : { body: [children], footer: [] };
  const [slot] = useState(createSlot);
  return (
    <BottomSheetModal visible={visible} onClose={onClose} maxHeightPct={maxHeightPct} bare>
      <SlotContext.Provider value={slot}>
        {/* Rise-up sheets have no Close button — drag down, tap outside or back. */}
        <ModalHead title={title} onClose={onClose} hideClose />
        {headExtra}
        {scroll ? (
          <SheetScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={{ flexShrink: 1 }}
            contentContainerStyle={[s.body, footer.length ? { paddingBottom: 12 } : null, bodyStyle]}
          >
            {body}
          </SheetScrollView>
        ) : (
          <View style={[{ flexShrink: 1 }, bodyStyle]}>{children}</View>
        )}
        <FooterSlot slot={slot} auto={footer} />
      </SlotContext.Provider>
    </BottomSheetModal>
  );
}

/** Shared overlay for the centre and top-slide modals (not draggable). */
function useOverlay(
  visible: boolean,
  onClose: () => void,
  render: (anim: Animated.Value) => React.ReactNode,
  deps: unknown[],
  onShown?: () => void
) {
  const anim = useRef(new Animated.Value(0)).current;
  const shownRef = useRef(onShown);
  shownRef.current = onShown;
  // The open animation starts only once the overlay has been published and
  // drawn (next frame). Starting it in the same effect that mounts it ran
  // the first part of the slide before the view existed — it looked like
  // it jumped in.
  const pendingOpen = useRef(false);
  const idRef = useRef<string>(undefined as unknown as string);
  if (!idRef.current) idRef.current = nextSheetId();
  const [mounted, setMounted] = useState(visible);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      pendingOpen.current = true;
    } else {
      pendingOpen.current = false;
      Keyboard.dismiss();
      Animated.timing(anim, {
        toValue: 0,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
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
    if (visible && pendingOpen.current) {
      pendingOpen.current = false;
      requestAnimationFrame(() =>
        Animated.timing(anim, {
          toValue: 1,
          duration: 320,
          easing: Easing.bezier(0.32, 0.72, 0, 1),
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) shownRef.current?.();
        })
      );
    }
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
            {
              opacity: anim,
              transform: [
                {
                  scale: anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.96, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <ModalHead title={title} onClose={onClose} />
          {children}
        </Animated.View>
      </View>
    ),
    [children, title],
  );
  return null;
}

/** .modal-backdrop.top-modal + .modal-card.top-slide (global search). */
export function TopModal({
  visible,
  onClose,
  onOpened,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  /** Fires once the panel has finished sliding in. */
  onOpened?: () => void;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  // A fixed slide distance close to the panel's height: re-measuring it
  // mid-slide changed the interpolation under a running animation (a
  // visible hitch), and a fixed 700px spent half the slide off-screen.
  const travel = insets.top + 420;
  // Opened from a control that recorded its position (the search icon):
  // the panel grows out of that point and unfolds downward instead of
  // sliding in from above. Read once per opening.
  const [origin, setOrigin] = useState<OverlayOrigin | null>(null);
  const [wasVisible, setWasVisible] = useState(false);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setOrigin(takeOverlayOrigin());
  }
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
            origin
              ? {
                  opacity: anim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
                  transformOrigin: [origin.x, origin.y, 0],
                  transform: [
                    { scaleX: anim.interpolate({ inputRange: [0, 1], outputRange: [0.12, 1] }) },
                    { scaleY: anim.interpolate({ inputRange: [0, 1], outputRange: [0.04, 1] }) },
                  ],
                }
              : {
                  opacity: anim.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 1] }),
                  transform: [
                    {
                      translateY: anim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-travel, 0],
                      }),
                    },
                  ],
                },
          ]}
        >
          {/* Hero colour behind the status bar, matching every page header. */}
          <View style={[s.topInset, { height: insets.top }]}>
            <HeroBackground />
          </View>
          {children}
        </Animated.View>
      </View>
    ),
    [children, insets.top, travel, origin],
    onOpened
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
  footer: {
    paddingTop: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: C.line,
    backgroundColor: C.card,
    gap: 8,
  },
  backdrop: { backgroundColor: "rgba(10,8,20,0.48)" },
  overlayCenter: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  floatingCard: {
    width: "100%",
    maxHeight: "76%",
    backgroundColor: C.card,
    borderRadius: 22,
    overflow: "hidden",
    boxShadow: "0px 24px 60px rgba(0,0,0,0.35)",
  },
  topInset: { position: "absolute", top: 0, left: 0, right: 0, overflow: "hidden" },
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
