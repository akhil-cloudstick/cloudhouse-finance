import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Animated, AppState, Linking, Pressable, StyleSheet, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { C } from "./base";
import { PIcon } from "./PIcon";
import { PrimaryButton } from "./PrimaryButton";
import { Txt } from "./Txt";
import { useOverlay, s as overlay } from "./Sheet";

// Android's "Allow <app> to take pictures?" dialog is drawn by the OS and can't be restyled. So
// the app asks first, in its own design: this card explains why the camera is needed, and only
// its "Allow camera" button raises the OS dialog. If the permission was blocked for good ("Don't
// ask again"), the OS dialog can never show again — the card says so and opens Settings instead.

type CameraPermissionCardProps = {
  /** Why the camera is needed, in the words of the screen asking. */
  reason: string;
  /** The OS won't ask again: the button opens Settings instead. */
  blocked: boolean;
  busy?: boolean;
  onAllow: () => void;
  /** Omitted where the screen already has its own way out (the connect screen). */
  onCancel?: () => void;
};

/** The branded "allow camera" card, used inline (QR scanner) and in the prompt overlay below. */
export function CameraPermissionCard({ reason, blocked, busy, onAllow, onCancel }: CameraPermissionCardProps) {
  return (
    <View style={s.card}>
      <View style={s.iconWrap}>
        <PIcon name="camera" color={C.brandDeep} size={30} />
      </View>
      <Txt style={s.title}>{blocked ? "Camera access is off" : "Allow camera access"}</Txt>
      <Txt style={s.body}>
        {blocked ? "Camera access was turned off for this app. Open Settings, tap Permissions → Camera and choose Allow." : reason}
      </Txt>
      <View style={s.note}>
        <PIcon name="shield" color={C.muted} size={14} />
        <Txt style={s.noteTxt}>The camera is only used while you scan or take a photo.</Txt>
      </View>
      <PrimaryButton label={blocked ? "Open settings" : "Allow camera"} onPress={onAllow} loading={busy} />
      {onCancel ? (
        <Pressable onPress={onCancel} hitSlop={8} style={s.cancel}>
          <Txt style={s.cancelTxt}>Not now</Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Re-checks a permission when the user comes back to the app (e.g. from Settings). */
export function useRecheckOnReturn(enabled: boolean, recheck: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") recheck();
    });
    return () => sub.remove();
  }, [enabled, recheck]);
}

// ---------------------------------------------------------------------------
// Prompt for code that isn't a component (fromCamera() in DocumentField).
// ---------------------------------------------------------------------------
type Ask = { reason: string; blocked: boolean; resolve: (granted: boolean) => void };
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

/** Resolves true once the camera may be used. Asks with the branded card first when needed;
 * resolves false if the user backs out. */
export async function ensureCameraPermission(reason = "Allow camera access to take a photo of the document."): Promise<boolean> {
  const now = await ImagePicker.getCameraPermissionsAsync();
  if (now.granted) return true;
  current?.resolve(false);
  return new Promise((resolve) => setAsk({ reason, blocked: !now.canAskAgain, resolve }));
}

function finish(granted: boolean) {
  const ask = current;
  setAsk(null);
  ask?.resolve(granted);
}

/** Mounted once in RootLayout, next to SheetHost; draws the card over everything when asked. */
export function CameraPermissionHost() {
  const ask = useSyncExternalStore(store.subscribe, store.get, store.get);
  // The last ask stays drawn while the overlay fades out.
  const [shown, setShown] = useState<Ask | null>(ask);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  if (ask && ask !== shown) {
    setShown(ask);
    setBlocked(ask.blocked);
    setBusy(false);
  }

  // Back from Settings with the camera now allowed: carry straight on to the camera.
  const recheck = React.useCallback(() => {
    ImagePicker.getCameraPermissionsAsync().then((p) => {
      if (p.granted && current) finish(true);
    });
  }, []);
  useRecheckOnReturn(!!ask && blocked, recheck);

  async function allow() {
    if (blocked) {
      Linking.openSettings();
      return;
    }
    setBusy(true);
    const p = await ImagePicker.requestCameraPermissionsAsync().catch(() => null);
    setBusy(false);
    if (p?.granted) finish(true);
    else if (p && !p.canAskAgain) setBlocked(true);
    else finish(false);
  }

  useOverlay(
    !!ask,
    () => finish(false),
    (anim: Animated.Value) => (
      <View style={overlay.overlayCenter} pointerEvents={ask ? "auto" : "none"}>
        <Animated.View style={[StyleSheet.absoluteFill, overlay.backdrop, { opacity: anim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => finish(false)} />
        </Animated.View>
        <Animated.View
          style={{ width: "100%", alignItems: "center", opacity: anim, transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }}
        >
          {shown ? <CameraPermissionCard reason={shown.reason} blocked={blocked} busy={busy} onAllow={allow} onCancel={() => finish(false)} /> : null}
        </Animated.View>
      </View>
    ),
    [ask, shown, blocked, busy]
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
  body: { fontSize: 13.5, lineHeight: 20, color: C.muted, textAlign: "center", marginBottom: 14 },
  note: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.brandFaint, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 18 },
  noteTxt: { fontSize: 11.5, color: C.muted, flexShrink: 1 },
  cancel: { marginTop: 12, paddingVertical: 6, paddingHorizontal: 16 },
  cancelTxt: { fontSize: 13.5, fontWeight: "700", color: C.brandDeep },
});
