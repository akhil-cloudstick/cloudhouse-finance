import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, BackHandler, Easing, Keyboard, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { nextSheetId, sheetStore } from "../SheetHost";
import { C } from "./base";

// Dropdown menu layer — the standard mobile dropdown: the field stays where
// it is, the list opens directly under it (or above it when there isn't
// room below), a transparent backdrop covers the rest of the screen, and a
// tap anywhere outside / hardware back / picking an item closes it. The
// menu is published into SheetHost so no card, sheet or scroll view can
// clip it or grow when it opens.

export type Anchor = { x: number; y: number; w: number; h: number };

const GAP = 4;
const EDGE = 8;
// The overlay layer's window origin and height barely ever change, so the
// last measurement is reused on the next open — the list can then show on
// its first frame instead of waiting for a fresh native measure.
let lastOrigin: { x: number; y: number } | null = null;
let lastLayerH = 0;

// The list sits on its own layer at a fixed screen position, so it has to
// be told when the form under it moves — a sheet/page scrolling (by hand, or
// Android scrolling the focused field into view) or a sheet resizing for
// the keyboard. Scrollers and sheets call this; an open list re-measures
// its field on the next frame and follows it.
const shiftListeners = new Set<() => void>();
export function notifyLayoutShift() {
  shiftListeners.forEach((l) => l());
}

// A scroll the user starts (dragging the sheet/page behind the list) closes
// any open list, like a native dropdown.
const dragListeners = new Set<() => void>();
export function notifyUserScroll() {
  dragListeners.forEach((l) => l());
}

/** Measures `ref` in window coordinates. */
export function useAnchor() {
  const ref = useRef<View>(null);
  const measure = useCallback((cb: (a: Anchor) => void) => {
    const node = ref.current;
    if (!node) return;
    node.measureInWindow((x, y, w, h) => cb({ x, y, w, h }));
  }, []);
  return { ref, measure };
}

function Layer({
  anchor,
  onClose,
  onRemeasure,
  maxHeight,
  minWidth,
  header,
  awaitKeyboard,
  children,
}: {
  anchor: Anchor;
  onClose: () => void;
  onRemeasure?: () => void;
  maxHeight: number;
  minWidth: number;
  header?: React.ReactNode;
  awaitKeyboard?: boolean;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const [kbTop, setKbTop] = useState<number | null>(null);
  // Natural (unclipped) size of the list: fixed header + scroll content.
  const [headH, setHeadH] = useState(0);
  const [contentH, setContentH] = useState(0);
  const h = contentH ? headH + contentH + 10 : 0;
  // Where this layer itself sits in window coordinates. The field is
  // measured with measureInWindow, which on Android (edge-to-edge, keyboard
  // up) doesn't always share the overlay's origin — the list then landed
  // over the field. Measuring the layer the same way and subtracting keeps
  // both in one coordinate space.
  const rootRef = useRef<View>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(lastOrigin);
  const [layerH, setLayerH] = useState(lastLayerH);
  const measureOrigin = useCallback(() => {
    rootRef.current?.measureInWindow((x, y, _w, lh) => {
      lastOrigin = { x, y };
      if (lh > 0) {
        lastLayerH = lh;
        setLayerH((v) => (v === lh ? v : lh));
      }
      setOrigin((o) => (o && o.x === x && o.y === y ? o : { x, y }));
    });
  }, []);
  useEffect(measureOrigin, [anchor, measureOrigin]);
  const cbRef = useRef({ onClose, onRemeasure });
  useEffect(() => {
    cbRef.current = { onClose, onRemeasure };
  });

  useEffect(() => {
    let frame: number | null = null;
    const onShift = () => {
      if (frame != null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        cbRef.current.onRemeasure?.();
      });
    };
    shiftListeners.add(onShift);
    const onDrag = () => cbRef.current.onClose();
    dragListeners.add(onDrag);
    return () => {
      shiftListeners.delete(onShift);
      dragListeners.delete(onDrag);
      if (frame != null) cancelAnimationFrame(frame);
    };
  }, []);

  // Typeable dropdowns open together with the keyboard, which takes a
  // moment to come up and then shrinks/scrolls the sheet — showing the list
  // straight away made it jump (often flipping above the field). Hold it
  // until the keyboard is up and the field has stopped moving.
  const [kbWait, setKbWait] = useState(() => !!awaitKeyboard && !Keyboard.isVisible());
  const kbShown = useRef(false);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!kbWait) return;
    const done = () => setKbWait(false);
    // No keyboard came (hardware keyboard, focus lost) — show anyway.
    const fallback = setTimeout(done, 1200);
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      kbShown.current = true;
      clearTimeout(fallback);
      if (settle.current) clearTimeout(settle.current);
      settle.current = setTimeout(done, 350);
    });
    return () => {
      clearTimeout(fallback);
      sub.remove();
      if (settle.current) clearTimeout(settle.current);
    };
  }, [kbWait]);
  useEffect(() => {
    // Each re-measure after the keyboard is up restarts a short settle.
    if (!kbWait || !kbShown.current) return;
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => setKbWait(false), 90);
  }, [anchor, kbWait]);

  useEffect(() => {
    // The keyboard can shift the form under the field — re-measure once it
    // has settled (twice: right away and after the sheet's own animation).
    const timers: ReturnType<typeof setTimeout>[] = [];
    const settle = () => {
      timers.push(setTimeout(() => cbRef.current.onRemeasure?.(), 60));
      timers.push(setTimeout(() => cbRef.current.onRemeasure?.(), 320));
    };
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", (e) => {
      setKbTop(e.endCoordinates.screenY);
      settle();
    });
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => {
      setKbTop(null);
      settle();
    });
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      cbRef.current.onClose();
      return true;
    });
    return () => {
      timers.forEach(clearTimeout);
      show.remove();
      hide.remove();
      back.remove();
    };
  }, []);

  const oy = origin?.y ?? 0;
  const ox = origin?.x ?? 0;
  // Field and keyboard edge, relative to this layer.
  const fy = anchor.y - oy;
  const fx = anchor.x - ox;
  const topLimit = insets.top + EDGE;
  const bottomLimit = (kbTop != null ? Math.min(kbTop, win.height) : win.height - insets.bottom) - EDGE;
  const width = Math.min(Math.max(anchor.w, minWidth), win.width - EDGE * 2);
  const left = Math.min(Math.max(fx, EDGE), win.width - width - EDGE);

  const below = bottomLimit - (fy + anchor.h + GAP);
  const above = fy - GAP - topLimit;
  // When even a full-height list fits below the field, it opens below
  // right away. Only near the bottom of the screen does it wait one layout
  // pass for its real height to decide between below and above.
  const fitsBelow = below >= maxHeight;
  const up = !fitsBelow && h > 0 && Math.min(h, maxHeight) > below && above > below;
  const room = Math.max(0, up ? above : below);
  const cap = Math.min(maxHeight, room);
  const ready = !kbWait && !!origin && (fitsBelow || h > 0) && (!up || layerH > 0);
  // Above the field it's pinned by its bottom edge, so it needs no height.
  const place = up ? { bottom: layerH - (fy - GAP) } : { top: fy + anchor.h + GAP };

  // Short fade + settle once it can be placed.
  const [fade] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!ready) return;
    Animated.timing(fade, { toValue: 1, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [ready, fade]);

  return (
    <View ref={rootRef} collapsable={false} onLayout={measureOrigin} style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Closes on touch-down, so starting to scroll the form behind also
          closes the list instead of the list staying put while it moves. */}
      <Pressable style={StyleSheet.absoluteFill} onPressIn={onClose} accessibilityLabel="Close list" />
      <Animated.View
        style={[
          s.panel,
          place,
          {
            left,
            width,
            maxHeight: cap,
            opacity: ready ? fade : 0,
            transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [up ? 4 : -4, 0] }) }],
          },
        ]}
      >
        {header ? <View onLayout={(e) => setHeadH(e.nativeEvent.layout.height)}>{header}</View> : null}
        <ScrollView
          style={{ flexShrink: 1 }}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator={contentH + headH + 10 > cap}
          onContentSizeChange={(_, ch) => setContentH(Math.max(1, ch))}
        >
          {children}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

/** Publishes the menu while `anchor` is set. `children` are the list rows
 * (scrolled inside the panel); `header` sits fixed above them (search box). */
export function Popover({
  anchor,
  onClose,
  onRemeasure,
  maxHeight = 280,
  minWidth = 140,
  header,
  awaitKeyboard,
  children,
}: {
  anchor: Anchor | null;
  onClose: () => void;
  /** Re-measure the field (called after the keyboard shows/hides). */
  onRemeasure?: () => void;
  maxHeight?: number;
  minWidth?: number;
  header?: React.ReactNode;
  /** The field opens the keyboard (typeable dropdown): wait for it. */
  awaitKeyboard?: boolean;
  children: React.ReactNode;
}) {
  const [id] = useState(nextSheetId);

  // Re-published on every render while open, so the menu always shows the
  // owner's latest options/selection (SheetHost re-renders alone).
  useEffect(() => {
    if (!anchor) {
      sheetStore.remove(id);
      return;
    }
    sheetStore.set(
      id,
      <Layer anchor={anchor} onClose={onClose} onRemeasure={onRemeasure} maxHeight={maxHeight} minWidth={minWidth} header={header} awaitKeyboard={awaitKeyboard}>
        {children}
      </Layer>
    );
  });
  useEffect(() => () => sheetStore.remove(id), [id]);
  return null;
}

const s = StyleSheet.create({
  panel: {
    position: "absolute",
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    padding: 4,
    overflow: "hidden",
    boxShadow: "0px 10px 24px rgba(43,26,94,0.18)",
  },
});
