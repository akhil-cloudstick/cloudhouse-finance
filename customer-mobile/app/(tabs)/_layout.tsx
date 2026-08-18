import { Tabs } from "expo-router/js-tabs";
import { colors } from "../../src/theme/colors";
import { AppTabBar } from "../../src/components/AppTabBar";

// Bottom-bar nav for the customer app, 5 destinations per the Batch 1 plan:
// Home (real) plus four ComingSoon stubs wired as real routes now so their
// batches slot in later without restructuring. Every screen renders its own
// FloatingHeader (see index.tsx) rather than using this navigator's header,
// since only Home needs the notification-bell affordance in this batch.
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.ivory },
        popToTopOnBlur: true,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="loans" options={{ title: "My Loans" }} />
      <Tabs.Screen name="payments" options={{ title: "Payments" }} />
      <Tabs.Screen name="documents" options={{ title: "Documents" }} />
      <Tabs.Screen name="more" options={{ title: "More" }} />
    </Tabs>
  );
}
