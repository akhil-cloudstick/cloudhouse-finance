import { useState, useSyncExternalStore } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { C } from "./base";
import { PIcon } from "./PIcon";
import { PrimaryButton } from "./PrimaryButton";
import { Txt } from "./Txt";
import { useOverlay, s as overlay } from "./Sheet";

// The in-app replacement for the system Alert.alert() that used to say "Document ready — Your PDF
// has been downloaded" (Open / Share / Close). presentFile() isn't a component, so it asks through
// this small store and FilePromptHost (mounted once in RootLayout) draws the card.

export type FileChoice = "open" | "share" | "close";

type Ask = { title: string; message: string; resolve: (choice: FileChoice) => void };
let current: Ask | null = null;
const listeners = new Set<() => void>();
function setAsk(next: Ask | null) {
  current = next;
  listeners.forEach((l) => l());
}
const store = {
  get: () => current,
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

/** Shows the themed card and resolves with what the user picked ("close" if dismissed). */
export function askFileAction(title: string, message = "Your PDF has been downloaded."): Promise<FileChoice> {
  current?.resolve("close");
  return new Promise((resolve) => setAsk({ title, message, resolve }));
}

function finish(choice: FileChoice) {
  const ask = current;
  setAsk(null);
  ask?.resolve(choice);
}

/** Mounted once in RootLayout, next to SheetHost; draws the card over everything when asked. */
export function FilePromptHost() {
  const ask = useSyncExternalStore(store.subscribe, store.get, store.get);
  // The last ask stays drawn while the overlay fades out.
  const [shown, setShown] = useState<Ask | null>(ask);
  if (ask && ask !== shown) setShown(ask);

  useOverlay(
    !!ask,
    () => finish("close"),
    (anim: Animated.Value) => (
      <View style={overlay.overlayCenter} pointerEvents={ask ? "auto" : "none"}>
        <Animated.View style={[StyleSheet.absoluteFill, overlay.backdrop, { opacity: anim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => finish("close")} />
        </Animated.View>
        <Animated.View
          style={{ width: "100%", alignItems: "center", opacity: anim, transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }}
        >
          {shown ? (
            <View style={s.card}>
              <View style={s.iconWrap}>
                <PIcon name="doc" color={C.brandDeep} size={30} />
              </View>
              <Txt style={s.title} numberOfLines={2}>{shown.title}</Txt>
              <Txt style={s.body}>{shown.message}</Txt>
              <View style={s.actions}>
                <PrimaryButton label="Open" onPress={() => finish("open")} />
                <PrimaryButton label="Share / Save" variant="outline" onPress={() => finish("share")} />
              </View>
              <Pressable onPress={() => finish("close")} hitSlop={8} style={s.cancel}>
                <Txt style={s.cancelTxt}>Close</Txt>
              </Pressable>
            </View>
          ) : null}
        </Animated.View>
      </View>
    ),
    [ask, shown]
  );
  return null;
}

const s = StyleSheet.create({
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: C.card,
    borderRadius: 22,
    paddingTop: 26,
    paddingHorizontal: 22,
    paddingBottom: 18,
    alignItems: "center",
    boxShadow: "0px 18px 40px rgba(43, 26, 94, 0.22)",
  },
  iconWrap: { width: 68, height: 68, borderRadius: 22, backgroundColor: C.brandPale, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  title: { fontSize: 18, fontWeight: "800", color: C.ink, textAlign: "center", marginBottom: 8 },
  body: { fontSize: 13.5, lineHeight: 20, color: C.muted, textAlign: "center", marginBottom: 18 },
  actions: { width: "100%", gap: 10 },
  cancel: { marginTop: 12, paddingVertical: 6, paddingHorizontal: 16 },
  cancelTxt: { fontSize: 13.5, fontWeight: "700", color: C.brandDeep },
});
