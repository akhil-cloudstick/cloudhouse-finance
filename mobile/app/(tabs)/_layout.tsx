// `expo-router`'s root export of `Tabs` is deprecated in SDK 57 — the
// supported path is `expo-router/js-tabs`.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSegments } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { Dimensions, Easing, View } from "react-native";
import { HeaderHost, HeaderHostContext, PTabBar, ShellContext, type ShellActions } from "../../src/components/ui";
import { GoldRateModal, MoreSheet, ProfileSheet, RemindersModal, SearchModal } from "../../src/components/staff/ShellModals";
import { CreateLoanSheet } from "../../src/components/staff/CreateLoanSheet";
import { CollectPaymentSheet } from "../../src/components/staff/loan/CollectPaymentSheet";
import { useQuery } from "@tanstack/react-query";
import { getLoan } from "../../src/api/loans";
import { toast } from "../../src/components/ui";
import { useTheme } from "../../src/theme/ThemeProvider";
import { routeEnabled } from "../../src/config/tenantModules";

// Staff shell (ui-demos/staff-app-prototype.html): a persistent floating tab
// bar — Dashboard / Customers / Loans (centre FAB) / Schemes / More — and
// screen-owned headers (every screen renders its own FlatHeader/HeroHeader
// via <Screen>, so navigators here never draw one: headerShown is false
// everywhere). Every other module is reached from the More sheet.
//
// ShellContext carries the global openers — New Loan, More, search, gold
// rate, reminders, profile — so every header and quick action drives the one
// instance of each sheet mounted here.
const SCREEN_W = Dimensions.get("window").width;

// One guard for every optional module (src/config/tenantModules.ts): catches
// a deep link, a stale nav state, or a module switched off while open.
function useTenantModuleGuard() {
  const segments = useSegments();
  const router = useRouter();
  const { hasModule, ready } = useTheme();
  const route = (segments as string[])[1] ?? "";

  useEffect(() => {
    if (ready && route && !routeEnabled(route, hasModule)) router.replace("/(tabs)/dashboard");
  }, [ready, route, hasModule, router]);
}

type SheetName = "newLoan" | "more" | "search" | "gold" | "reminders" | "profile" | null;

// Collect Payment opened from a list or the dashboard: fetch just this loan
// and show its sheet over the current page — no loan-detail navigation.
function CollectLauncher({ loanId, onClose }: { loanId: number | null; onClose: () => void }) {
  const loan = useQuery({ queryKey: ["loan", String(loanId)], queryFn: () => getLoan(loanId!), enabled: loanId != null });
  useEffect(() => {
    if (loanId != null && loan.isError) {
      toast.error("Couldn't open Collect Payment", "The loan could not be loaded — try again.");
      onClose();
    }
  }, [loanId, loan.isError, onClose]);
  if (loanId == null || !loan.data || loan.data.id !== loanId) return null;
  return <CollectPaymentSheet loan={loan.data} visible onClose={onClose} />;
}

export default function TabsLayout() {
  useTenantModuleGuard();
  const [open, setOpen] = useState<SheetName>(null);
  const close = useCallback(() => setOpen(null), []);
  const [collectLoanId, setCollectLoanId] = useState<number | null>(null);
  const closeCollect = useCallback(() => setCollectLoanId(null), []);
  const actions = useMemo<ShellActions>(
    () => ({
      openNewLoan: () => setOpen("newLoan"),
      openMore: () => setOpen("more"),
      openSearch: () => setOpen("search"),
      openGoldRate: () => setOpen("gold"),
      openReminders: () => setOpen("reminders"),
      openProfile: () => setOpen("profile"),
      openCollect: (loanId: number) => setCollectLoanId(loanId),
    }),
    []
  );

  return (
    <ShellContext.Provider value={actions}>
      <HeaderHostContext.Provider value>
      <View style={{ flex: 1 }}>
      <Tabs
        tabBar={(props) => <PTabBar {...props} />}
        // Back walks the pages visited (so a page opened from a quick link
        // returns to where it was opened), rather than jumping to Dashboard.
        backBehavior="history"
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: "transparent" },
          // A tab keeps its stack when left, so Back can return to the exact
          // page; tapping the tab in the bar resets it to the module root.
          // openPage() (Shell.tsx) switches tabs and resets a tab's stack in
          // one dispatch, so a hidden tab is never rendered mid-flight with
          // stale content to freeze in place — every tab can freeze on blur.
          freezeOnBlur: true,
          // Slide only — no opacity (Android redraws elevation shadows under
          // an animating opacity, which made edges flash).
          sceneStyleInterpolator: ({ current }) => ({
            sceneStyle: {
              transform: [
                { translateX: current.progress.interpolate({ inputRange: [-1, 0, 1], outputRange: [-SCREEN_W, 0, SCREEN_W] }) },
              ],
            },
          }),
          transitionSpec: { animation: "timing", config: { duration: 220, easing: Easing.out(Easing.cubic) } },
        }}
      >
        {/* --- tab bar destinations --- */}
        <Tabs.Screen name="dashboard" options={{ title: "Dashboard" }} />
        <Tabs.Screen name="customers" options={{ title: "Customers", lazy: false }} />
        <Tabs.Screen name="loans" options={{ title: "Loans", lazy: false }} />
        <Tabs.Screen name="schemes" options={{ title: "Schemes" }} />

        {/* --- reachable from the More sheet --- */}
        <Tabs.Screen name="auctions" options={{ title: "Auctions", href: null }} />
        <Tabs.Screen name="packets" options={{ title: "Packets & Lockers", href: null }} />
        <Tabs.Screen name="banks" options={{ title: "Bank Pledges", href: null }} />
        <Tabs.Screen name="requests" options={{ title: "Requests", href: null }} />
        <Tabs.Screen name="cash" options={{ title: "Ledger", href: null }} />
        <Tabs.Screen name="personal-loans" options={{ title: "Personal Loans", href: null }} />
        <Tabs.Screen name="investments" options={{ title: "Investments", href: null }} />
        <Tabs.Screen name="reminders" options={{ title: "Reminders", href: null }} />
        <Tabs.Screen name="reports" options={{ title: "Reports", href: null }} />
        <Tabs.Screen name="loan-risk" options={{ title: "Loan Risk", href: null }} />
        <Tabs.Screen name="employees" options={{ title: "Employees", href: null }} />
        <Tabs.Screen name="branches" options={{ title: "Branches", href: null }} />
        <Tabs.Screen name="roles" options={{ title: "Roles & Permissions", href: null }} />
        <Tabs.Screen name="settings" options={{ title: "Settings", href: null }} />
      </Tabs>
      {/* One header above every page — see Screen in Shell.tsx. */}
      <HeaderHost />
      </View>
      </HeaderHostContext.Provider>

      <CreateLoanSheet visible={open === "newLoan"} onClose={close} />
      <MoreSheet visible={open === "more"} onClose={close} onGoldRate={() => setOpen("gold")} />
      <SearchModal visible={open === "search"} onClose={close} />
      <GoldRateModal visible={open === "gold"} onClose={close} />
      <RemindersModal visible={open === "reminders"} onClose={close} />
      <ProfileSheet visible={open === "profile"} onClose={close} />
      <CollectLauncher loanId={collectLoanId} onClose={closeCollect} />
    </ShellContext.Provider>
  );
}
