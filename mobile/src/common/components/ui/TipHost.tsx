import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions, type GestureResponderEvent } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";

// The phone's version of the web's hover tooltip: hold something and a small dark bubble with its full text appears
// next to your finger. It closes after a few seconds or on a tap. Mounted once in RootLayout, next to ToastHost.
type Tip = { id: number; text: string; x: number; y: number } | null;

let current: Tip = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Shows `text` as a tooltip at the point of the touch (`e` is the long-press event). */
export function showTip(text: string, e?: GestureResponderEvent) {
  const t = text.trim();
  if (!t) return;
  const ne = (e?.nativeEvent ?? {}) as { pageX?: number; pageY?: number; locationX?: number };
  // No touch point reported (some devices): x / y stay -1 and the bubble is drawn near the top, centred.
  current = { id: ++seq, text: t, x: typeof ne.pageX === "number" ? ne.pageX : -1, y: typeof ne.pageY === "number" ? ne.pageY : -1 };
  emit();
}

/** Shows `text` as a tooltip at a screen point. */
export function showTipAt(text: string, x: number, y: number) {
  const t = text.trim();
  if (!t) return;
  current = { id: ++seq, text: t, x, y };
  emit();
}

// Shorter than the phone's own long-press (about half a second), which on a text box starts text selection and
// takes the touch away — the tooltip has to be up before that happens.
const HOLD_MS = 320;
// When the touch is taken away like that (a cancel, not a lift), the finger may still be down: the tooltip stays
// a moment so it can be read, then goes.
const CANCEL_HIDE_MS = 1500;
const HOLD_SLOP = 12;

/** Hold detection that works on ANY view — including a text box being typed in, which swallows a normal long-press.
 * Spread the result onto the view: a finger that stays down ~half a second shows `getText()` as a tooltip; moving or
 * lifting first cancels it. Touch events bubble, so putting this on a wrapper also covers the children inside it. */
export function useHoldTip(getText: () => string | undefined) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  return {
    onTouchStart: (e: GestureResponderEvent) => {
      clear();
      const { pageX, pageY } = e.nativeEvent;
      origin.current = { x: pageX, y: pageY };
      timer.current = setTimeout(() => {
        timer.current = null;
        const text = getText();
        if (text) showTipAt(text, origin.current.x, origin.current.y);
      }, HOLD_MS);
    },
    onTouchMove: (e: GestureResponderEvent) => {
      const { pageX, pageY } = e.nativeEvent;
      if (Math.abs(pageX - origin.current.x) > HOLD_SLOP || Math.abs(pageY - origin.current.y) > HOLD_SLOP) clear();
    },
    // Letting go closes the tooltip straight away.
    onTouchEnd: () => {
      clear();
      hideTip();
    },
    onTouchCancel: () => {
      clear();
      const id = current?.id;
      if (id != null) setTimeout(() => current?.id === id && hideTip(), CANCEL_HIDE_MS);
    },
  };
}

export function hideTip() {
  if (!current) return;
  current = null;
  emit();
}

const SHOW_MS = 4500;
const MAX_W = 300;

export function TipHost() {
  const [tip, setTip] = useState<Tip>(current);
  const { width, height } = useWindowDimensions();
  useEffect(() => {
    const l = () => setTip(current);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  useEffect(() => {
    if (!tip) return;
    const id = tip.id;
    const t = setTimeout(() => {
      if (current?.id === id) hideTip();
    }, SHOW_MS);
    return () => clearTimeout(t);
  }, [tip]);
  if (!tip) return null;
  const w = Math.min(MAX_W, width - 24);
  const known = tip.x >= 0 && tip.y >= 0;
  const left = known ? Math.max(12, Math.min(tip.x - w / 2, width - w - 12)) : (width - w) / 2;
  // Below the finger, or above it when the touch is in the lower part of the screen.
  const below = !known || tip.y < height * 0.62;
  const place = !known ? { top: height * 0.18 } : below ? { top: tip.y + 22 } : { bottom: height - tip.y + 22 };
  return (
    // Same top-most layer the toasts use, so the bubble is never hidden behind a sheet or a modal panel.
    <View style={[StyleSheet.absoluteFill, { zIndex: 100000, elevation: 100000 }]} pointerEvents="box-none">
      <Pressable
        onPress={hideTip}
        accessibilityRole="alert"
        style={[{ position: "absolute", left, width: w, backgroundColor: C.nav, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 }, place]}
      >
        <Txt style={{ color: "#fff", fontSize: 12.5, lineHeight: 18 }}>{tip.text}</Txt>
      </Pressable>
    </View>
  );
}
