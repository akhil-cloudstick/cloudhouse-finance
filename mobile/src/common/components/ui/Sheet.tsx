import React, { createContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Animated, BackHandler, Easing, Keyboard, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { BottomSheetModal } from "./BottomSheetModal";
import { SheetScrollView } from "./SheetScrollView";
import { nextSheetId, sheetStore } from "./SheetHost";
import { C } from "./base";
import { ModalHead } from "./ModalHead";

// ---- footer slot ----------------------------------------------------------
// Lets a component nested deep inside a sheet (e.g. a review panel) put its
// action buttons in that sheet's sticky footer: <SheetFooter> publishes into
// a tiny per-sheet store that only the footer slot subscribes to, so the
// publish never re-renders the sheet body (no update loop).
type Slot = { get: () => React.ReactNode; set: (n: React.ReactNode) => void; subscribe: (l: () => void) => () => void };
export const SlotContext = createContext<Slot | null>(null);

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

type FooterSlotProps = { slot: Slot; auto: React.ReactNode[] };

function FooterSlot({ slot, auto }: FooterSlotProps) {
  const node = useSyncExternalStore(slot.subscribe, slot.get);
  if (!node && !auto.length) return null;
  return (
    <View style={s.footer}>
      {node}
      {auto}
    </View>
  );
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

type SheetProps = {
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
};

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
}: SheetProps) {
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
export function useOverlay(
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

export const s = StyleSheet.create({
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
