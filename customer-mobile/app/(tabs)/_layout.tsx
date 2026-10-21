import { Tabs } from "expo-router/js-tabs";
import { colors } from "@/common/theme/colors";
import { AppTabBar } from "@/common/components/layout/AppTabBar";

// Each screen renders its own FloatingHeader rather than using this navigator's header.
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        popToTopOnBlur: true,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="loans" options={{ title: "My Loans" }} />
      <Tabs.Screen name="payments" options={{ title: "Payments" }} />
      <Tabs.Screen name="documents" options={{ title: "Documents" }} />
      <Tabs.Screen name="more" options={{ title: "Profile" }} />
    </Tabs>
  );
}
