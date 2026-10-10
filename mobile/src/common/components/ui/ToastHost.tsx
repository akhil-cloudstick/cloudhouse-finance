import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C } from "./base";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";

// In-app toast — the themed replacement for a native Alert.alert() when all
// we have to say is "done" or "that failed". One at a time, slides down
// from the top above every screen and sheet (ToastHost is mounted after
// SheetHost in app/_layout.tsx), dismisses itself or on tap.

export type ToastTone = "success" | "error" | "info";
type ToastMsg = { id: number; title: string; message?: string; tone: ToastTone };

let current: ToastMsg | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const store = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  get: () => current,
};

export const toast = {
  show(title: string, opts: { message?: string; tone?: ToastTone } = {}) {
    current = { id: ++seq, title, message: opts.message, tone: opts.tone ?? "success" };
    emit();
  },
  success: (title: string, message?: string) => toast.show(title, { message, tone: "success" }),
  error: (title: string, message?: string) => toast.show(title, { message, tone: "error" }),
  info: (title: string, message?: string) => toast.show(title, { message, tone: "info" }),
  hide(id?: number) {
    if (!current || (id != null && current.id !== id)) return;
    current = null;
    emit();
  },
};

const TONE: Record<ToastTone, { fg: string; bg: string; icon: string }> = {
  success: { fg: C.green, bg: C.greenBg, icon: "check" },
  error: { fg: C.red, bg: C.redBg, icon: "alert" },
  info: { fg: C.brandDeep, bg: C.brandPale, icon: "bell" },
};

export function ToastHost() {
  const msg = useSyncExternalStore(store.subscribe, store.get, store.get);
  const insets = useSafeAreaInsets();
  const [anim] = useState(() => new Animated.Value(0));
  const [shown, setShown] = useState<ToastMsg | null>(null);

  useEffect(() => {
    if (msg) {
      setShown(msg);
      anim.setValue(0);
      Animated.timing(anim, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      const t = setTimeout(() => toast.hide(msg.id), msg.tone === "error" ? 4200 : 2600);
      return () => clearTimeout(t);
    }
    Animated.timing(anim, { toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
      if (finished) setShown(null);
    });
  }, [msg, anim]);

  if (!shown) return null;
  const tone = TONE[shown.tone];
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 100000, elevation: 100000 }]} pointerEvents="box-none">
      <Animated.View
        style={[
          s.wrap,
          { top: insets.top + 10, opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }] },
        ]}
      >
        <Pressable style={s.card} onPress={() => toast.hide(shown.id)} accessibilityRole="alert">
          <View style={[s.ic, { backgroundColor: tone.bg }]}>
            <PIcon name={tone.icon} color={tone.fg} size={16} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt style={s.title}>{shown.title}</Txt>
            {shown.message ? <Txt style={s.msg}>{shown.message}</Txt> : null}
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: "absolute", left: 16, right: 16 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line,
    paddingVertical: 12,
    paddingHorizontal: 14,
    boxShadow: "0px 12px 30px rgba(43,26,94,0.20)",
  },
  ic: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  title: { fontWeight: "700", fontSize: 13.5 },
  msg: { fontSize: 12, color: C.muted, marginTop: 2 },
});
