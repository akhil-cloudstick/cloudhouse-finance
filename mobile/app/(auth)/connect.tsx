import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Image, Keyboard, Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../src/auth/AuthContext";
import { isValidBusinessCode, normalizeBusinessCode, parseConnectQr } from "../../src/auth/businessCode";
import { fetchPublicBranding, resolveLogoUrl } from "../../src/api/branding";
import { QrScanner } from "../../src/components/QrScanner";
import { ThemedText } from "../../src/components/ThemedText";
import { GoldButton } from "../../src/components/GoldButton";
import { Icon } from "../../src/components/Icon";
import { toast } from "../../src/components/ui/Toast";
import { AuthShell, AuthField, AuthButton, AuthError, AuthLink, KeyboardAnchor } from "../../src/components/AuthKit";
import { HEADER_LOGO } from "../../src/config/brand";
import { colors } from "../../src/theme/colors";

// The app's first screen until a business is connected — the mobile half of
// the web dashboard's "Connect mobile app" QR (frontend ConnectMobileModal).
// Scanning it (or typing the code, or opening the cloudhouse://connect link
// from the phone camera) shows a short "Connecting to <business>" step, then
// stores the code; RootNavigation sees `businessCode` change and moves on to
// that business's login page. Nothing here signs anyone in.
//
// The business is not verified here: /public/branding/:code answers every
// code (unknown ones get the platform default) so it can't be used to list
// businesses, and a wrong code then fails at sign-in like a wrong password.
type Mode = "scan" | "type" | "loading";

export default function ConnectScreen() {
  const insets = useSafeAreaInsets();
  const { connectBusiness } = useAuth();
  const params = useLocalSearchParams<{ b?: string }>();
  const [mode, setMode] = useState<Mode>("scan");
  const [armed, setArmed] = useState(true);
  const [typed, setTyped] = useState("");
  const [typeError, setTypeError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ code: string; name: string; logo: string | null } | null>(null);
  // Bumped by Cancel (and by every new attempt) so a branding fetch that
  // finishes after the user cancelled is ignored instead of connecting.
  const attempt = useRef(0);

  const connect = useCallback(
    async (code: string) => {
      Keyboard.dismiss();
      const mine = ++attempt.current;
      setPending({ code, name: "", logo: null });
      setMode("loading");
      try {
        const b = await fetchPublicBranding(code);
        if (mine !== attempt.current) return;
        setPending({ code, name: b.name, logo: resolveLogoUrl(b.logoUrl) });
      } catch {
        if (mine !== attempt.current) return;
        toast.error("Couldn't reach the server", "Check your connection and try again.");
        setMode("scan");
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

  // cloudhouse://connect?b=<code> — the phone camera opened the app on this
  // screen with the business already in the link.
  useEffect(() => {
    const code = typeof params.b === "string" ? parseConnectQr(params.b) : null;
    if (!code) return;
    // Started off the effect's own tick — connect() sets state straight away.
    const t = setTimeout(() => connect(code), 0);
    return () => clearTimeout(t);
  }, [params.b, connect]);

  const cancel = () => {
    attempt.current++;
    setPending(null);
    setMode("scan");
  };

  // Hardware Back steps out of "type"/"loading" back to the scanner; on the
  // scanner itself it's left to Android's default (leave the app).
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (mode === "scan") return false;
      cancel();
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
    connect(code);
  }

  function submitTyped() {
    const code = normalizeBusinessCode(typed);
    if (!isValidBusinessCode(code)) {
      setTypeError("That business code doesn't look right — letters, numbers and dashes only.");
      return;
    }
    setTypeError(null);
    connect(code);
  }

  if (mode === "type") {
    return (
      <AuthShell
        eyebrow="Connect"
        title={"Enter your\nbusiness code."}
        subtitle="It's shown under the QR code in your web dashboard."
        onBack={() => setMode("scan")}
      >
        <AuthField
          label="Business code"
          icon="home"
          placeholder="e.g. ambika"
          autoCapitalize="none"
          autoCorrect={false}
          value={typed}
          onChangeText={setTyped}
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

  return (
    <View style={styles.scanWrap}>
      <QrScanner
        embedded
        visible={mode === "scan" && armed}
        onClose={() => {}}
        onScanned={onScanned}
        permissionText="Allow camera access to scan the QR code from your web dashboard."
      />

      <View style={[styles.scanTop, { paddingTop: insets.top + 20 }]} pointerEvents="none">
        <View style={styles.logoTile}>
          <Image source={HEADER_LOGO} resizeMode="contain" style={styles.logo} />
        </View>
        <ThemedText variant="h2" color="#ffffff" style={styles.center}>
          Scan to connect
        </ThemedText>
        <ThemedText variant="body" color="rgba(255,255,255,0.85)" style={styles.center}>
          Open your web dashboard and tap the phone icon in the header.
        </ThemedText>
      </View>

      <View style={[styles.scanBottom, { paddingBottom: insets.bottom + 20 }]}>
        <GoldButton title="Enter business code" icon="note" onPress={() => setMode("type")} style={styles.fullWidth} />
        <Pressable onPress={() => BackHandler.exitApp()} hitSlop={10} style={({ pressed }) => [styles.exitBtn, pressed && { opacity: 0.7 }]}>
          <Icon name="chevronLeft" size={16} color="#ffffff" />
          <ThemedText variant="label" color="#ffffff">
            Exit
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: "center" },
  fullWidth: { alignSelf: "stretch" },

  scanWrap: { flex: 1, backgroundColor: "#000" },
  scanTop: { position: "absolute", top: 0, left: 0, right: 0, alignItems: "center", gap: 8, paddingHorizontal: 32 },
  logoTile: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  logo: { width: 44, height: 44 },
  scanBottom: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 24, alignItems: "center", gap: 14 },
  exitBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, paddingHorizontal: 12 },

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
