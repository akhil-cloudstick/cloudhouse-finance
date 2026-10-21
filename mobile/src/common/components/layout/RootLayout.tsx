import { useEffect, useState, type ReactNode } from "react";
import { DefaultTheme, Slot, ThemeProvider as NavThemeProvider, useRouter, useSegments } from "expo-router";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { useFonts } from "@expo-google-fonts/ibm-plex-sans/useFonts";
import { IBMPlexSans_400Regular } from "@expo-google-fonts/ibm-plex-sans/400Regular";
import { IBMPlexSans_500Medium } from "@expo-google-fonts/ibm-plex-sans/500Medium";
import { IBMPlexSans_600SemiBold } from "@expo-google-fonts/ibm-plex-sans/600SemiBold";
import { NunitoSans_800ExtraBold } from "@expo-google-fonts/nunito-sans";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { Asset } from "expo-asset";
import { View, ActivityIndicator, AppState, type AppStateStatus, StatusBar as RNStatusBar, Platform } from "react-native";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { ThemeProvider, useTheme } from "@/common/theme/ThemeProvider";
import { SheetHost } from "@/common/components/ui/SheetHost";
import { ToastHost } from "@/common/components/ui/ToastHost";
import { PrintProgressHost } from "@/common/components/ui/PrintProgressHost";
import { KeyboardDoneBar } from "@/common/components/ui/KeyboardDoneBar";
import { AnimatedSplash } from "@/common/components/ui/AnimatedSplash";
import { AuthProvider, useAuth } from "@/common/providers/AuthProvider";
import { colors } from "@/common/theme/colors";
import { useDismissKeyboardOnOutsideTouch } from "@/common/hooks/use-dismiss-keyboard-on-outside-touch";

SplashScreen.preventAutoHideAsync();

// Paints the Android window background immediately (ivory, not OS-default white) before React mounts/lays out.
SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});

const queryClient = new QueryClient();

// Without this every navigator falls back to React Navigation's stock light theme, flashing grey/white on page switches.
const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.bg, card: colors.bg },
};

// RN has no 'visibilitychange' event for refetchOnWindowFocus; bridges AppState so stale queries refetch on foreground.
AppState.addEventListener("change", (status: AppStateStatus) => {
  focusManager.setFocused(status === "active");
});

// Forces translucent+transparent status bar on Android 14 and older / Expo Go, where edge-to-edge isn't enforced.
function useAndroidStatusBarTranslucency() {
  useEffect(() => {
    if (Platform.OS !== "android") return;
    RNStatusBar.setTranslucent(true);
    RNStatusBar.setBackgroundColor("transparent");
  }, []);
}


function RootNavigation() {
  const { employee, isLoading, businessCode } = useAuth();
  const { colors: themed } = useTheme();
  const segments = useSegments();
  const router = useRouter();
  useAndroidStatusBarTranslucency();
  const dismissKeyboard = useDismissKeyboardOnOutsideTouch();

  // No business → connect screen; business but signed out → its login; signed in → dashboard.
  useEffect(() => {
    if (isLoading) return;
    const inAuthGroup = segments[0] === "(auth)";
    const onConnect = inAuthGroup && (segments as string[])[1] === "connect";
    if (employee) {
      if (inAuthGroup) router.replace("/(tabs)/dashboard");
    } else if (!businessCode) {
      if (!onConnect) router.replace("/(auth)/connect");
    } else if (!inAuthGroup || onConnect) {
      router.replace("/(auth)/login");
    }
  }, [employee, isLoading, businessCode, segments, router]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <StatusBar style="dark" />
        <ActivityIndicator color={themed.brand} />
      </View>
    );
  }

  return (
    // Closes the keyboard on any touch outside the field being typed in — see useDismissKeyboardOnOutsideTouch.
    <View style={{ flex: 1, backgroundColor: colors.bg }} {...dismissKeyboard}>
      {/* Every page header paints the hero gradient up behind the status bar, so icons are light everywhere. */}
      <StatusBar style="light" />
      <NavThemeProvider value={navTheme}>
        <Slot />
      </NavThemeProvider>
      {/* Bottom sheets render here — above every screen, see SheetHost.tsx. */}
      <SheetHost />
      <ToastHost />
      <PrintProgressHost />
      <KeyboardDoneBar />
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    NunitoSans_800ExtraBold,
  });
  // Preloads the login logo so it's cached by the time the login screen mounts, avoiding a pop-in frame.
  const [assetsLoaded, setAssetsLoaded] = useState(false);

  useEffect(() => {
    Asset.loadAsync([require("../../../../assets/cloudhouse.png"), require("../../../../assets/header-logo.png")])
      .catch(() => {})
      .finally(() => setAssetsLoaded(true));
  }, []);

  // ThemeProvider mounts before fonts so its cached-brand read runs in parallel; SplashGate waits for all three.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <SplashGate loaded={fontsLoaded && assetsLoaded}>
            <AuthProvider>
              <RootNavigation />
            </AuthProvider>
          </SplashGate>
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

type SplashGateProps = { loaded: boolean; children: ReactNode };

// Keeps the native splash up until fonts/assets load AND the business's cached brand colour is applied.
function SplashGate({ loaded, children }: SplashGateProps) {
  const { ready } = useTheme();
  const show = loaded && ready;
  // The native splash hides once the animated splash has drawn its first (identical) frame, for a seamless hand-off.
  const [splashDone, setSplashDone] = useState(false);

  if (!show) return null;
  return (
    <>
      {children}
      {splashDone ? null : <AnimatedSplash onReady={() => SplashScreen.hideAsync().catch(() => {})} onDone={() => setSplashDone(true)} />}
    </>
  );
}
