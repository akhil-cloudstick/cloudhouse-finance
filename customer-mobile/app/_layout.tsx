import { useEffect, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { useFonts, Jost_400Regular, Jost_500Medium, Jost_600SemiBold, Jost_700Bold } from "@expo-google-fonts/jost";
import { NunitoSans_800ExtraBold } from "@expo-google-fonts/nunito-sans";
import * as SplashScreen from "expo-splash-screen";
import { Asset } from "expo-asset";
import * as LocalAuthentication from "expo-local-authentication";
import { View, ActivityIndicator } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { ThemeProvider } from "../src/theme/ThemeProvider";
import { SheetHost } from "../src/components/SheetHost";
import { AuthProvider, useAuth } from "../src/auth/AuthContext";
import { NotificationsProvider } from "../src/notifications/NotificationsContext";
import { colors } from "../src/theme/colors";
import { getToken, clearToken } from "../src/auth/tokenStorage";
import { getDeviceToken, clearDeviceToken } from "../src/auth/deviceToken";
import * as authApi from "../src/api/auth";
import { ApiError } from "../src/api/client";

SplashScreen.preventAutoHideAsync();

// Same "paint the status-bar strip explicitly" fix as mobile/app/_layout.tsx
// — see that file's doc comment (Android edge-to-edge, SDK 57+).
function StatusBarBackdrop() {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top, backgroundColor: colors.ivory }}
    />
  );
}

// Cold-start sign-in bootstrap, per the plan's app/_layout.tsx root logic:
//   1. A registered device token exists -> prompt biometric -> on success,
//      exchange it for a fresh session JWT via device-login (server-side
//      validated, not just a local unlock). Any failure here (biometric
//      cancel/fail, or the server rejects the device token as
//      revoked/expired) falls back to the OTP login screen — never a dead
//      end.
//   2. No device token, but a stored session token exists -> try refresh to
//      confirm it's still valid; on success go straight to (tabs).
//   3. Neither -> OTP login screen.
async function bootstrapSession(
  completeLogin: (s: authApi.SessionResponse) => Promise<void>,
  markAuthenticated: () => void,
  refreshProfile: () => Promise<void>
): Promise<void> {
  const deviceToken = await getDeviceToken();
  if (deviceToken) {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = hasHardware && (await LocalAuthentication.isEnrolledAsync());
      if (isEnrolled) {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: "Sign in to Ambika Gold Finance",
          disableDeviceFallback: false,
        });
        if (result.success) {
          try {
            const session = await authApi.deviceLogin(deviceToken);
            await completeLogin(session);
            // Refresh in the background for freshness — completeLogin
            // already has a customer object from the device-login response,
            // so this isn't load-bearing, just keeps KYC/profile fields
            // current.
            refreshProfile().catch(() => {});
            return;
          } catch {
            // The SERVER rejected this token (revoked/expired) — it's
            // genuinely dead, so clear it. This is the only case that
            // clears the token; a cancelled/failed biometric prompt below
            // leaves it intact so the login screen's "Login with biometric"
            // button can retry without forcing a full OTP re-verification.
            await clearDeviceToken();
            return;
          }
        }
        // Biometric prompt was shown but cancelled/failed — the token
        // itself is still fine, just leave it for the login screen to
        // offer a retry via its own "Login with biometric" button.
        return;
      }
    } catch {
      // hasHardwareAsync/isEnrolledAsync itself threw — fall through to
      // OTP below without touching the token (a transient platform hiccup
      // shouldn't discard a working credential).
    }
  }

  const sessionToken = await getToken();
  if (sessionToken) {
    try {
      await authApi.refresh();
      markAuthenticated();
      // Unlike the device-login path above, a session-token refresh has no
      // customer object of its own — this is the one bootstrap path that
      // actually needs GET /customer/profile to populate `customer` at all.
      // Non-blocking: a transient failure here shouldn't fail the whole
      // bootstrap, just leave `customer` null until the next successful call.
      await refreshProfile().catch(() => {});
      return;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await clearToken();
      }
    }
  }
}

function RootNavigation() {
  const { isAuthenticated, isLoading, setLoading, completeLogin, markAuthenticated, refreshProfile } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    (async () => {
      await bootstrapSession(completeLogin, markAuthenticated, refreshProfile);
      setLoading(false);
      setBootstrapped(true);
    })();
    // Intentionally runs once on mount only — re-running this on every
    // segments/router change would re-trigger a biometric prompt whenever
    // navigation state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isLoading || !bootstrapped) return;
    const inAuthGroup = segments[0] === "(auth)";
    if (!isAuthenticated && !inAuthGroup) {
      router.replace("/(auth)/login");
    } else if (isAuthenticated && inAuthGroup) {
      router.replace("/(tabs)");
    }
  }, [isAuthenticated, isLoading, bootstrapped, segments, router]);

  if (isLoading || !bootstrapped) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.ivory }}>
        <StatusBar style="dark" />
        <ActivityIndicator color={colors.gold} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <StatusBar style="dark" />
      {/* A real Stack, not <Slot/> — (tabs) needs to stay mounted underneath
          pushed top-level siblings so its tab state (which tab was active)
          survives the round trip. With a bare Slot, pushing into a sibling
          top-level route unmounted (tabs) entirely; popping back then
          remounted it fresh, always landing on the first tab (Home)
          regardless of which tab the user had open. */}
      <Stack screenOptions={{ headerShown: false }} />
      <SheetHost />
      <StatusBarBackdrop />
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Jost_400Regular,
    Jost_500Medium,
    Jost_600SemiBold,
    Jost_700Bold,
    NunitoSans_800ExtraBold,
  });
  // The login screen's logo <Image> was popping in a frame after its
  // surrounding card/inputs — fonts were the only thing gating the splash
  // screen, so it hid as soon as they resolved while the logo asset was
  // still being read/decoded off-thread. Preloading it here means it's
  // already in the image cache by the time the login screen mounts, so it
  // paints in the same frame as everything else.
  const [assetsLoaded, setAssetsLoaded] = useState(false);

  useEffect(() => {
    Asset.loadAsync(require("../assets/ambika-gold.png"))
      .catch(() => {})
      .finally(() => setAssetsLoaded(true));
  }, []);

  useEffect(() => {
    if (fontsLoaded && assetsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded, assetsLoaded]);

  if (!fontsLoaded || !assetsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <AuthProvider>
          <NotificationsProvider>
            <RootNavigation />
          </NotificationsProvider>
        </AuthProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
