import { useEffect } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts, Jost_400Regular, Jost_500Medium, Jost_600SemiBold } from "@expo-google-fonts/jost";
import { BodoniModaSC_600SemiBold } from "@expo-google-fonts/bodoni-moda-sc";
import * as SplashScreen from "expo-splash-screen";
import { View, ActivityIndicator } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemeProvider } from "../src/theme/ThemeProvider";
import { SheetHost } from "../src/components/sheetHost";
import { AuthProvider, useAuth } from "../src/auth/AuthContext";
import { colors } from "../src/theme/colors";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

// The strip behind the Android status bar was grey, not ivory: the app draws
// edge-to-edge (SDK 57+ enforces it) so that strip shows whatever view sits
// under it, and the navigator's own container paints React Navigation's
// default rgb(242,242,242) there — over the root View's ivory. This paints
// the inset area explicitly, on top of every navigator, so it always matches
// the theme. (`expo-status-bar`'s backgroundColor can't do this job any
// more — it's a no-op under edge-to-edge.)
function StatusBarBackdrop() {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: insets.top,
        backgroundColor: colors.ivory,
      }}
    />
  );
}

function RootNavigation() {
  const { employee, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    const inAuthGroup = segments[0] === "(auth)";
    if (!employee && !inAuthGroup) {
      router.replace("/(auth)/login");
    } else if (employee && inAuthGroup) {
      router.replace("/(tabs)/dashboard");
    }
  }, [employee, isLoading, segments, router]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.ivory }}>
        <StatusBar style="dark" />
        <ActivityIndicator color={colors.gold} />
      </View>
    );
  }

  return (
    // Android draws edge-to-edge (SDK 57+ enforces this), so the strip
    // behind the status bar is whatever this outer view's background is —
    // without it, that strip defaults to white against the app's ivory
    // theme. `style="dark"` picks dark status-bar icons/text to read
    // against that light background.
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <StatusBar style="dark" />
      <Slot />
      {/* Bottom sheets render here — above every screen, laid out against
          the real screen bounds. See src/components/sheetHost.tsx. */}
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
    BodoniModaSC_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <RootNavigation />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
