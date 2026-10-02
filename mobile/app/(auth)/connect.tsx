import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Image, Keyboard, Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../src/auth/AuthContext";
import { isValidConnectCode, normalizeConnectCode, parseConnectQr } from "../../src/auth/businessCode";
import { fetchPublicBranding, redeemConnectCode, resolveLogoUrl } from "../../src/api/branding";
import { ApiError } from "../../src/api/client";
import { QrScanner } from "../../src/components/QrScanner";
import { ThemedText } from "../../src/components/ThemedText";
import { GoldButton } from "../../src/components/GoldButton";
import { Icon } from "../../src/components/Icon";
import { toast } from "../../src/components/ui/Toast";
import { AuthShell, AuthField, AuthButton, AuthError, AuthLink, KeyboardAnchor, SecureNote } from "../../src/components/AuthKit";
import { HEADER_LOGO } from "../../src/config/brand";
import { useTheme } from "../../src/theme/ThemeProvider";
import { colors } from "../../src/theme/colors";

// The app's first screen after the splash until a business is connected —
// the mobile half of the web dashboard's "Connect mobile app" QR (frontend
// ConnectMobileModal). It's a one-time step: it opens on a "Scan to enter a
// business" choice — scan the QR, or type the 6-character connect code shown
// under it — and either path (or the cloudhouse://connect link opened from
// the phone camera) swaps that short-lived code for the business
// (/public/connect/:code), shows a short "Connecting to <business>" step,
// then stores the business code; RootNavigation sees `businessCode` change and moves on to that
// business's login page. From then on the app opens straight on login until
// someone chooses "Exit business". Nothing here signs anyone in.
//
// A wrong or expired connect code is refused by the server (404) and the
// user goes back to scan or type a fresh one.
type Mode = "choose" | "scan" | "type" | "loading";

export default function ConnectScreen() {
  const insets = useSafeAreaInsets();
  const { connectBusiness } = useAuth();
  const params = useLocalSearchParams<{ c?: string }>();
  const [mode, setMode] = useState<Mode>("choose");
  const [armed, setArmed] = useState(true);
  const [typed, setTyped] = useState("");
  const [typeError, setTypeError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ code: string; name: string; logo: string | null } | null>(null);
  // Bumped by Cancel (and by every new attempt) so a branding fetch that
  // finishes after the user cancelled is ignored instead of connecting.
  const attempt = useRef(0);
  // Where Cancel / a failed lookup returns to — the step the attempt came from.
  const from = useRef<Mode>("choose");

  const connect = useCallback(
    async (connectCode: string, origin: Mode) => {
      Keyboard.dismiss();
      const mine = ++attempt.current;
      from.current = origin;
      setPending({ code: "", name: "", logo: null });
      setMode("loading");
      let code = "";
      try {
        code = (await redeemConnectCode(connectCode)).businessCode;
        if (mine !== attempt.current) return;
        setPending({ code, name: "", logo: null });
        const b = await fetchPublicBranding(code);
        if (mine !== attempt.current) return;
        setPending({ code, name: b.name, logo: resolveLogoUrl(b.logoUrl) });
      } catch (err) {
        if (mine !== attempt.current) return;
        if (err instanceof ApiError && err.status === 404) {
          toast.error("Code expired or invalid", "Get a new code from your web dashboard and try again.");
        } else {
          toast.error("Couldn't reach the server", "Check your connection and try again.");
        }
        setMode(origin);
        return;
      }
      // A brief beat on the business's own name/logo so the user sees which
      // business they're connecting to before the login page replaces it.
      await new Promise((r) => setTimeout(r, 700));
      if (mine !== attempt.current) return;
      await connectBusiness(code);
    },
    [connectBusiness]
  );

  // cloudhouse://connect?c=<code> — the phone camera opened the app on this
  // screen with the connect code already in the link.
  useEffect(() => {
    const code = typeof params.c === "string" ? parseConnectQr(params.c) : null;
    if (!code) return;
    // Started off the effect's own tick — connect() sets state straight away.
    const t = setTimeout(() => connect(code, "choose"), 0);
    return () => clearTimeout(t);
  }, [params.c, connect]);

  const cancel = () => {
    attempt.current++;
    setPending(null);
    setMode(from.current);
  };

  const backToChoose = () => {
    Keyboard.dismiss();
    setTypeError(null);
    setMode("choose");
  };

  // Hardware Back: "loading" cancels back to the step it came from, "scan"
  // and "type" return to the choice; on the choice itself it's left to
  // Android's default (leave the app).
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (mode === "choose") return false;
      if (mode === "loading") cancel();
      else backToChoose();
      return true;
    });
    return () => sub.remove();
  }, [mode]);

  function onScanned(data: string) {
    const code = parseConnectQr(data);
    if (!code) {
      toast.error("Not a business QR", "Scan the QR from your web dashboard's header.");
      // Pause, then re-arm the scanner — otherwise the same wrong QR still
      // in view would fire again on the very next frame.
      setArmed(false);
      setTimeout(() => setArmed(true), 1500);
      return;
    }
    connect(code, "scan");
  }

  function submitTyped() {
    const code = normalizeConnectCode(typed);
    if (!isValidConnectCode(code)) {
      setTypeError("That code doesn't look right — it's the 6 letters and numbers shown under the QR code.");
      return;
    }
    setTypeError(null);
    connect(code, "type");
  }

  if (mode === "type") {
    return (
      <AuthShell
        eyebrow="Enter code"
        title={"Enter the\nconnect code."}
        subtitle="It's the 6-character code shown under the QR code in your web dashboard."
        onBack={backToChoose}
      >
        <AuthField
          label="Connect code"
          icon="home"
          placeholder="e.g. ABC 234"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={7}
          value={typed}
          onChangeText={(v) => setTyped(v.toUpperCase())}
          onSubmitEditing={submitTyped}
          returnKeyType="go"
        />
        <AuthError message={typeError} />
        <KeyboardAnchor>
          <AuthButton title="Continue" onPress={submitTyped} disabled={!typed.trim()} />
        </KeyboardAnchor>
        <AuthLink label="Scan QR code instead" onPress={() => setMode("scan")} />
      </AuthShell>
    );
  }

  if (mode === "loading") {
    return (
      <View style={[styles.loadingWrap, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.loadingCard}>
          <View style={styles.loadingLogo}>
            <Image source={pending?.logo ? { uri: pending.logo } : HEADER_LOGO} resizeMode="contain" style={styles.loadingLogoImg} />
          </View>
          <ThemedText variant="small" color={colors.muted}>
            Connecting to
          </ThemedText>
          <ThemedText variant="h2" color={colors.ink} style={styles.center} numberOfLines={2}>
            {pending?.name || pending?.code || ""}
          </ThemedText>
          <ActivityIndicator color={colors.brand} style={styles.spinner} />
          <GoldButton title="Cancel" variant="outline" onPress={cancel} style={styles.fullWidth} />
        </View>
      </View>
    );
  }

  if (mode === "scan") {
    return (
      <View style={styles.scanWrap}>
        <QrScanner
          embedded
          visible={armed}
          onClose={() => {}}
          onScanned={onScanned}
          permissionText="Allow camera access to scan the QR code from your web dashboard."
        />

        <View style={[styles.scanTop, { paddingTop: insets.top + 16 }]}>
          <Pressable onPress={backToChoose} hitSlop={10} style={({ pressed }) => [styles.scanBack, pressed && { opacity: 0.7 }]}>
            <Icon name="chevronLeft" size={20} color="#ffffff" />
          </Pressable>
          <ThemedText variant="h2" color="#ffffff" style={styles.center}>
            Scan business QR
          </ThemedText>
          <ThemedText variant="body" color="rgba(255,255,255,0.85)" style={styles.center}>
            Open your web dashboard and tap the phone icon in the header.
          </ThemedText>
        </View>

        <View style={[styles.scanBottom, { paddingBottom: insets.bottom + 20 }]}>
          <GoldButton title="Enter code instead" icon="note" onPress={() => setMode("type")} style={styles.fullWidth} />
        </View>
      </View>
    );
  }

  return (
    <AuthShell
      eyebrow="One-time setup"
      title={"Scan to enter\na business."}
      subtitle="Connect this phone to your business once — after that it opens straight on sign in."
    >
      <ChoiceCard icon="scan" title="Scan QR code" sub="Use the QR from your web dashboard's header" onPress={() => setMode("scan")} />
      <ChoiceCard icon="note" title="Enter code manually" sub="Type the 6-character code shown under the QR" onPress={() => setMode("type")} />
      <SecureNote />
    </AuthShell>
  );
}

// One of the two ways in, as a large tappable row.
function ChoiceCard({ icon, title, sub, onPress }: { icon: string; title: string; sub: string; onPress: () => void }) {
  const { colors: themed } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        { backgroundColor: themed.bg, borderColor: pressed ? themed.brand : "transparent" },
        pressed && { transform: [{ scale: 0.99 }] },
      ]}
    >
      <View style={[styles.choiceIcon, { backgroundColor: themed.brandPale }]}>
        <Icon name={icon} size={22} color={themed.brand} />
      </View>
      <View style={styles.choiceText}>
        <ThemedText variant="body" color={themed.ink} style={styles.choiceTitle}>
          {title}
        </ThemedText>
        <ThemedText variant="small" color={themed.muted}>
          {sub}
        </ThemedText>
      </View>
      <View style={styles.choiceChevron}>
        <Icon name="chevronLeft" size={18} color={themed.muted} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: "center" },
  fullWidth: { alignSelf: "stretch" },

  choice: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 18, borderWidth: 2, padding: 14, marginBottom: 12 },
  choiceIcon: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  choiceText: { flex: 1, gap: 2 },
  choiceTitle: { fontSize: 16, fontWeight: "700" },
  // The icon set has only a left chevron — flipped to point forward.
  choiceChevron: { transform: [{ rotate: "180deg" }] },

  scanWrap: { flex: 1, backgroundColor: "#000" },
  scanTop: { position: "absolute", top: 0, left: 0, right: 0, alignItems: "center", gap: 8, paddingHorizontal: 32 },
  scanBack: {
    alignSelf: "flex-start",
    marginLeft: -12,
    marginBottom: 6,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
  scanBottom: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 24, alignItems: "center", gap: 14 },

  loadingWrap: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  loadingCard: {
    alignSelf: "stretch",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 24,
  },
  loadingLogo: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: colors.brandFaint,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  loadingLogoImg: { width: 56, height: 56 },
  spinner: { marginVertical: 18 },
});
