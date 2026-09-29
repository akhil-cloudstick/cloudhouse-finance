import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "../src/theme/ThemeProvider";
import { colors } from "../src/theme/colors";

// Landing route for the Aadhaar eSign redirect (cloudhouse://esign-callback,
// passed as redirectUrl in app/(tabs)/loans/[id].tsx). Without it, Setu's
// return deep-link opened Expo Router's "Unmatched Route" page. The URL
// carries no loan id, so this just steps back to the loan screen that
// launched the signing flow — which refetches on focus and shows the new
// status — or, if the app was killed while the browser was open and there's
// no history, falls back to the loans list.
export default function EsignCallback() {
  const router = useRouter();
  const { colors: themed } = useTheme();

  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/loans");
  }, [router]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
      <ActivityIndicator color={themed.brand} />
    </View>
  );
}
