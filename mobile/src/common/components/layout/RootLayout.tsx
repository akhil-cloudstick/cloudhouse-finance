import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DefaultTheme, Slot, ThemeProvider as NavThemeProvider, useRouter, useSegments } from "expo-router";
import { QueryClientProvider, focusManager } from "@tanstack/react-query";
import { queryClient } from "@/common/services/queryClient";
import { useFonts } from "@expo-google-fonts/ibm-plex-sans/useFonts";
import { IBMPlexSans_400Regular } from "@expo-google-fonts/ibm-plex-sans/400Regular";
import { IBMPlexSans_500Medium } from "@expo-google-fonts/ibm-plex-sans/500Medium";
import { IBMPlexSans_600SemiBold } from "@expo-google-fonts/ibm-plex-sans/600SemiBold";
import { NunitoSans_800ExtraBold } from "@expo-google-fonts/nunito-sans";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { Asset } from "expo-asset";
import { View, ActivityIndicator, AppState, Platform, type AppStateStatus } from "react-native";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { ThemeProvider, useTheme } from "@/common/theme/ThemeProvider";
import { SheetHost } from "@/common/components/ui/SheetHost";
import { ToastHost } from "@/common/components/ui/ToastHost";
import { TipHost } from "@/common/components/ui/TipHost";
import { PrintProgressHost } from "@/common/components/ui/PrintProgressHost";
import { CameraPermissionHost } from "@/common/components/ui/CameraPermission";
import { FilePromptHost } from "@/common/components/ui/FilePrompt";
import { KeyboardDoneBar } from "@/common/components/ui/KeyboardDoneBar";
import { AnimatedSplash } from "@/common/components/ui/AnimatedSplash";
import { AuthProvider, useAuth } from "@/common/providers/AuthProvider";
import { colors } from "@/common/theme/colors";
import * as ScreenOrientation from "expo-screen-orientation";
import { COLUMN_HARD_MAX, IS_TABLET, MeasuredColumnWidth } from "@/common/theme/layout";
import { useDismissKeyboardOnOutsideTouch } from "@/common/hooks/use-dismiss-keyboard-on-outside-touch";

SplashScreen.preventAutoHideAsync();

// The Android window's own background (what briefly shows through during a
// screen transition, before the incoming screen's own view has drawn over
// it) defaults to the OS theme's white, not this app's ivory — a plain RN
// `<View style={{ backgroundColor }}>` only paints once React has mounted
// and laid it out, one frame later. Setting it here paints the actual
// window straight away, so that gap (most visible going back from Forgot
// Password to Login, where the keyboard closing can stretch it out) shows
// this app's own background instead of stock white. A no-op on iOS/web.
SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});

// Without this every navigator (the Tabs container, each module Stack's
// card) falls back to React Navigation's stock light theme — a grey
// rgb(242,242,242) background and white cards. The tab scenes are
// transparent and slide in, and a lazily-mounted tab or a stack screen
// shows its card before its own content lays out, so page switches flashed
// that white/grey. Pointing both at the app's ivory makes any such gap
// match the page instead.
const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.bg, card: colors.bg },
};

// React Query's `refetchOnWindowFocus` (on by default) listens for a
// browser 'visibilitychange' event, which doesn't exist in React Native.
// Bridging AppState into focusManager gets the app-foreground half of that
// behaviour back (every "stale" query refetches when the app is
// backgrounded then reopened); see src/common/hooks/use-refetch-on-focus.ts for the
// other half — refetching when navigating back to an already-mounted
// screen within the app, which AppState alone doesn't cover.
AppState.addEventListener("change", (status: AppStateStatus) => {
  focusManager.setFocused(status === "active");
});

// The strip behind the Android status bar was grey, not ivory: the app draws
// edge-to-edge (SDK 57+ enforces it) so that strip shows whatever view sits
// under it, and the navigator's own container paints React Navigation's
// default rgb(242,242,242) there — over the root View's ivory. This paints
// the inset area explicitly, on top of every navigator, so it always matches
// the theme. (`expo-status-bar`'s backgroundColor can't do this job any
// more — it's a no-op under edge-to-edge.)
// Android tablets draw a system bar / taskbar (back, home, recents) across the bottom that the app can sit
// underneath without the OS reporting its height as a safe-area inset. Every screen sizes its bottom space
// (tab bar, lists, sheets, table area) from the bottom inset, so give it at least this much there and the
// whole app rides above the bar. A larger reported inset is left alone; phones are untouched.
const ANDROID_TABLET_NAV_MIN = 48;
function SystemBarInsets({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const value = useMemo(
    () => (Platform.OS === "android" && IS_TABLET && insets.bottom < ANDROID_TABLET_NAV_MIN ? { ...insets, bottom: ANDROID_TABLET_NAV_MIN } : insets),
    [insets]
  );
  return <SafeAreaInsetsContext.Provider value={value}>{children}</SafeAreaInsetsContext.Provider>;
}

function RootNavigation() {
  const { employee, isLoading, businessCode } = useAuth();
  const { colors: themed } = useTheme();
  const segments = useSegments();
  const router = useRouter();
  const dismissKeyboard = useDismissKeyboardOnOutsideTouch();
  // The column's real width, measured from the layout (not the reported window size, which can lag a rotation).
  const [columnWidth, setColumnWidth] = useState<number | null>(null);

  // Signed out with no business yet → the scanner (connect); signed out with
  // a business → that business's login; signed in → the dashboard. Connecting
  // a business (connect screen) and "Exit business" both just change
  // `businessCode`, and this moves the user on.
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
    // Android draws edge-to-edge on SDK 57+/Android 15+, so the strip
    // behind the status bar is whatever this outer view's background is —
    // without it, that strip defaults to white against the app's ivory
    // theme. `style="dark"` picks dark status-bar icons/text to read
    // against that light background. `translucent`/`backgroundColor` are
    // no-ops under enforced edge-to-edge, but they matter on Android 14 and
    // older (and in Expo Go), where the OS otherwise reserves an opaque
    // system-bar area and paints it black instead of drawing behind it.
    // Closes the keyboard on any touch outside the field being typed in —
    // see useDismissKeyboardOnOutsideTouch.
    <View style={{ flex: 1, backgroundColor: colors.bg }} {...dismissKeyboard}>
      <View
        style={{ flex: 1, width: "100%", maxWidth: segments[0] === "(auth)" ? 900 : COLUMN_HARD_MAX, alignSelf: "center" }}
        onLayout={(e) => {
          const w = Math.round(e.nativeEvent.layout.width);
          setColumnWidth((o) => (o === w ? o : w));
        }}
      >
      <MeasuredColumnWidth.Provider value={columnWidth}>
      {/* Every page header (and the auth brand panel) paints the hero
          gradient up behind the status bar, so its icons are light
          everywhere and no separate status-bar strip is drawn. */}
      <StatusBar style="light" />
      <NavThemeProvider value={navTheme}>
        <Slot />
      </NavThemeProvider>
      {/* Bottom sheets render here — above every screen, laid out against
          the real screen bounds. See src/common/components/ui/SheetHost.tsx. */}
      <SheetHost />
      <ToastHost />
      <TipHost />
      <PrintProgressHost />
      <CameraPermissionHost />
      <FilePromptHost />
      <KeyboardDoneBar />
      </MeasuredColumnWidth.Provider>
      </View>
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
  // The login screen's logo <Image> was popping in a frame after its
  // surrounding card/inputs — fonts were the only thing gating the splash
  // screen, so it hid as soon as they resolved while the logo asset was
  // still being read/decoded off-thread. Preloading it here means it's
  // already in the image cache by the time the login screen mounts, so it
  // paints in the same frame as everything else.
  const [assetsLoaded, setAssetsLoaded] = useState(false);

  // Tablets rotate freely; phones stay portrait exactly as before.
  useEffect(() => {
    (IS_TABLET ? ScreenOrientation.unlockAsync() : ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)).catch(() => {});
  }, []);

  useEffect(() => {
    Asset.loadAsync([require("../../../../assets/cloudhouse.png"), require("../../../../assets/header-logo.png")])
      .catch(() => {})
      .finally(() => setAssetsLoaded(true));
  }, []);

  // ThemeProvider mounts straight away (not after fonts) so its cached-brand
  // read runs in parallel with font loading; SplashGate holds the splash
  // until all three are done.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <SplashGate loaded={fontsLoaded && assetsLoaded}>
            <AuthProvider>
              <SystemBarInsets>
                <RootNavigation />
              </SystemBarInsets>
            </AuthProvider>
          </SplashGate>
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

type SplashGateProps = { loaded: boolean; children: ReactNode };

// Keeps the native splash up until fonts/assets are loaded AND the
// business's cached brand colour has been applied, so the platform default
// colour never flashes before the business's own. Sits under ThemeProvider
// because RootLayout renders the provider and so can't read it itself.
function SplashGate({ loaded, children }: SplashGateProps) {
  const { ready } = useTheme();
  const show = loaded && ready;
  // Once ready, the app renders underneath while the animated splash plays
  // over it; the native splash is hidden the moment the animated one has
  // drawn its first (identical) frame, so the hand-off is seamless.
  const [splashDone, setSplashDone] = useState(false);

  if (!show) return null;
  return (
    <>
      {children}
      {splashDone ? null : <AnimatedSplash onReady={() => SplashScreen.hideAsync().catch(() => {})} onDone={() => setSplashDone(true)} />}
    </>
  );
}
