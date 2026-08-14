import { useEffect } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts, Jost_400Regular, Jost_500Medium, Jost_600SemiBold } from "@expo-google-fonts/jost";
import { BodoniModaSC_600SemiBold } from "@expo-google-fonts/bodoni-moda-sc";
import * as SplashScreen from "expo-splash-screen";
import { View, ActivityIndicator } from "react-native";

import { ThemeProvider } from "../src/theme/ThemeProvider";
import { AuthProvider, useAuth } from "../src/auth/AuthContext";
import { colors } from "../src/theme/colors";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

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
      router.replace("/(drawer)/dashboard");
    }
  }, [employee, isLoading, segments, router]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.ivory }}>
        <ActivityIndicator color={colors.gold} />
      </View>
    );
  }

  return <Slot />;
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
