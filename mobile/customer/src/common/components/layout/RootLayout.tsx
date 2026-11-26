import { useEffect, useState } from "react";
import { BRAND } from "@/common/config/brand";
import { Stack, useRouter, useSegments } from "expo-router";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { Montserrat_700Bold } from "@expo-google-fonts/montserrat";
import { NunitoSans_800ExtraBold } from "@expo-google-fonts/nunito-sans";
import * as SplashScreen from "expo-splash-screen";
import { Asset } from "expo-asset";
import * as LocalAuthentication from "expo-local-authentication";
import { View, ActivityIndicator } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { ThemeProvider } from "@/common/theme/ThemeProvider";
import { SheetHost } from "@/common/components/ui/SheetHost";
import { AuthProvider, useAuth } from "@/common/providers/AuthProvider";
import { NotificationsProvider } from "@/common/providers/NotificationsProvider";
import { colors } from "@/common/theme/colors";
import { getToken, clearToken, saveToken } from "@/common/services/tokenStorage";
import { getDeviceToken, clearDeviceToken } from "@/common/services/deviceToken";
import * as authApi from "@/modules/auth/services/authService";
import { ApiError } from "@/common/services/httpClient";

SplashScreen.preventAutoHideAsync();

// Paints the status-bar strip explicitly for Android edge-to-edge (SDK 57+).
function StatusBarBackdrop() {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top, backgroundColor: colors.bg }}
    />
  );
}

// Cold-start: try device token + biometric, else refresh a stored session token, else fall back to OTP login.
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
          promptMessage: `Sign in to ${BRAND.legalName}`,
          disableDeviceFallback: false,
        });
        if (result.success) {
          try {
            const session = await authApi.deviceLogin(deviceToken);
            await completeLogin(session);
            refreshProfile().catch(() => {});
            return;
          } catch {
            // Only cleared when the server itself rejects the token as revoked/expired.
            await clearDeviceToken();
            return;
          }
        }
        // Biometric cancelled/failed: leave the token for the login screen's retry button.
        return;
      }
    } catch {
      // Platform hiccup checking hardware/enrollment: fall through to OTP without touching the token.
    }
  }

  const sessionToken = await getToken();
  if (sessionToken) {
    try {
      const { token } = await authApi.refresh();
      await saveToken(token);
      markAuthenticated();
      // Session-token refresh has no customer object of its own, so this path needs the profile fetch.
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
    // Runs once on mount; re-running on nav changes would re-trigger the biometric prompt.
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
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <StatusBar style="dark" />
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      {/* Real Stack, not <Slot/>: keeps (tabs) mounted underneath pushed siblings so its active tab survives. */}
      <Stack screenOptions={{ headerShown: false }} />
      <SheetHost />
      <StatusBarBackdrop />
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Montserrat_700Bold,
    NunitoSans_800ExtraBold,
  });
  // Preloaded so the login logo is cached before mount, avoiding a pop-in frame after the splash hides.
  const [assetsLoaded, setAssetsLoaded] = useState(false);

  useEffect(() => {
    Asset.loadAsync(require("../../../../assets/cloudhouse.png"))
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
