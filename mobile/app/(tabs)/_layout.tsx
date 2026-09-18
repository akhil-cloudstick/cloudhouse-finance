// `expo-router`'s root export of `Tabs` is deprecated in SDK 57 — the
// supported path is `expo-router/js-tabs` (there's also an
// `unstable-native-tabs` variant, avoided here because the whole point of
// this bar is a custom look).
import { Tabs } from "expo-router/js-tabs";
import { colors } from "../../src/theme/colors";
import { FloatingHeader } from "../../src/components/FloatingHeader";
import { AppTabBar } from "../../src/components/AppTabBar";
import { MoreSheetProvider } from "../../src/components/MoreSheet";

// Bottom-bar nav — replaces the old side drawer entirely. Four primary tabs
// (dashboard, loans, customers, new-loan) live in AppTabBar; every other
// module is reachable from the "More" slot, which raises the MoreSheet
// (grouped the same way the old sidebar was). Nothing opens a drawer any
// more — MoreSheetProvider is what both the tab bar and every screen's
// FloatingHeader ☰ button talk to.
//
// Header: every screen gets exactly ONE header, rendered by FloatingHeader
// as a floating rounded "island" bar. Screens below that own a nested Stack
// (their folder has its own _layout.tsx — customers, loans, auctions,
// banks, cash, employees, lockers, packets, schemes, settings, branches) set
// `headerShown: false` here so this navigator doesn't also render a header
// on top of the Stack's — that duplicate-header stacking was the earlier
// bug. Screens with no nested Stack (dashboard, gold-rates, new-loan,
// reminders, reports) get their header from here via `header` below.
//
// `href: null` on the non-tab screens is belt-and-braces: AppTabBar only
// ever renders the four TABS entries, but if the custom bar were ever
// swapped for the default BottomTabBar these screens still wouldn't leak
// into it as a row of 18 icons.
export default function TabsLayout() {
  return (
    <MoreSheetProvider>
      <Tabs
        tabBar={(props) => <AppTabBar {...props} />}
        screenOptions={{
          header: ({ options, route, navigation }) => (
            <FloatingHeader title={options.title ?? route.name} navigation={navigation} />
          ),
          // Without this the scene falls back to the navigation theme's
          // background, which used to be grey behind the status-bar strip.
          sceneStyle: { backgroundColor: "transparent" },
          // Leaving a tab resets its nested stack to that module's root, so
          // a tab never "remembers" a detail screen or a half-finished form
          // you'd already navigated away from. Without this, opening a loan
          // from the Dashboard left the Loans tab parked on that loan
          // forever — coming back to Loans showed the loan, not the list.
          popToTopOnBlur: true,
        }}
      >
        {/* --- the four primary tabs --- */}
        <Tabs.Screen name="dashboard" options={{ title: "Dashboard" }} />
        <Tabs.Screen name="loans" options={{ title: "Loans", headerShown: false }} />
        <Tabs.Screen name="customers" options={{ title: "Customers", headerShown: false }} />
        <Tabs.Screen name="new-loan" options={{ title: "New Loan" }} />

        {/* --- reachable from the More sheet only --- */}
        <Tabs.Screen name="packets" options={{ title: "Packets", headerShown: false, href: null }} />
        <Tabs.Screen name="reminders" options={{ title: "Reminders", href: null }} />
        <Tabs.Screen name="reports" options={{ title: "Reports", href: null }} />
        <Tabs.Screen name="schemes" options={{ title: "Schemes", headerShown: false, href: null }} />
        <Tabs.Screen name="personal-loans" options={{ title: "Personal Loans", headerShown: false, href: null }} />
        <Tabs.Screen name="investments" options={{ title: "Investments", headerShown: false, href: null }} />
        <Tabs.Screen name="gold-rates" options={{ title: "Gold Rates", href: null }} />
        <Tabs.Screen name="requests" options={{ title: "Extensions & Release", href: null }} />
        <Tabs.Screen name="loan-risk" options={{ title: "Loan Risk", href: null }} />
        <Tabs.Screen name="lockers" options={{ title: "Lockers", headerShown: false, href: null }} />
        <Tabs.Screen name="banks" options={{ title: "Bank Pledge", headerShown: false, href: null }} />
        <Tabs.Screen name="auctions" options={{ title: "Auctions", headerShown: false, href: null }} />
        <Tabs.Screen name="cash" options={{ title: "Cash & Expenses", headerShown: false, href: null }} />
        <Tabs.Screen name="employees" options={{ title: "Employees", headerShown: false, href: null }} />
        <Tabs.Screen name="settings" options={{ title: "Settings", headerShown: false, href: null }} />
        <Tabs.Screen name="branches" options={{ title: "Branches", headerShown: false, href: null }} />
        <Tabs.Screen name="roles" options={{ title: "Roles & Permissions", href: null }} />
      </Tabs>
    </MoreSheetProvider>
  );
}
