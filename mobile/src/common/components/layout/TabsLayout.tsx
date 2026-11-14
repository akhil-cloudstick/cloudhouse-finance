// `expo-router`'s root export of `Tabs` is deprecated in SDK 57 — the
// supported path is `expo-router/js-tabs`.
import type { Customer } from "@/modules/customers/types/customer-types";
import { syncPersistedSection } from "@/common/hooks/use-persisted-state";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSegments } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { Animated, Dimensions, Easing, View } from "react-native";
import { PanGestureHandler } from "react-native-gesture-handler";
import { PRIMARY_ROUTES, pageShift } from "@/common/components/ui/swipeStore";
import { useTabSwipe } from "@/common/hooks/use-tab-swipe";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C, HeaderHost, HeaderHostContext, openPage, PillButton, PTabBar, ShellContext, type ShellActions, Spinner, toast, Txt } from "@/common/components/ui";
import { CustomerFormSheet } from "@/modules/customers/components/CustomerFormSheet";
import { NoAccess } from "@/common/components/NoAccess";
import { PTAB_HEIGHT, PTAB_INSET, tabBarLift } from "@/common/theme/layout";
import { MoreSheet } from "./MoreSheet";
import { ProfileSheet } from "./ProfileSheet";
import { RemindersModal } from "./RemindersModal";
import { SearchModal } from "./SearchModal";
import { GoldRateModal } from "./GoldRateModal";
import type { LoanDraft } from "@/modules/loans/types/loan-types";
import { CreateLoanSheet } from "@/common/components/CreateLoanSheet";
import { CollectPaymentSheet } from "@/common/components/CollectPaymentSheet";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { setPagePrefetch, TabNameContext } from "@/common/components/ui/shellContext";
import { getLoan } from "@/modules/loans/services/loanService";
import { getCustomer } from "@/modules/customers/services/customerService";
import { useTheme } from "@/common/theme/ThemeProvider";
import { routeEnabled } from "@/common/config/tenantModules";
import { routeAllowed, setRouteChecker } from "@/common/config/routePermissions";
import { useAuth } from "@/common/providers/AuthProvider";

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

// One guard for every optional module (src/common/config/tenantModules.ts): catches
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

// Registers the checker openPage() uses (src/common/config/routePermissions.ts).
function useRoutePermissionGuard() {
  const { can, permissionsLoaded } = useAuth();

  useEffect(() => {
    setRouteChecker(permissionsLoaded ? can : null);
    return () => setRouteChecker(null);
  }, [can, permissionsLoaded]);
}

type RouteGateProps = { route: string; children: React.ReactElement };

// The permission twin of the guard above, decided during render so a page
// this role can't view (deep link, router.push()) never mounts.
function RouteGate({ route, children }: RouteGateProps) {
  const { can, permissionsLoaded } = useAuth();
  if (!permissionsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Spinner />
      </View>
    );
  }
  if (!routeAllowed(route, can)) return <NoAccess />;
  return <TabNameContext.Provider value={route}>{children}</TabNameContext.Provider>;
}

function PermissionsFailedBanner() {
  const { permissionsFailed, refetchPermissions } = useAuth();
  const insets = useSafeAreaInsets();
  const [retrying, setRetrying] = useState(false);
  if (!permissionsFailed) return null;
  const retry = () => {
    setRetrying(true);
    refetchPermissions().finally(() => setRetrying(false));
  };
  return (
    <View
      style={{
        position: "absolute",
        left: 18,
        right: 18,
        bottom: PTAB_INSET + PTAB_HEIGHT + tabBarLift(insets.bottom) + 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: C.redBg,
        borderRadius: 12,
        paddingVertical: 10,
        paddingHorizontal: 13,
      }}
    >
      <Txt style={{ flex: 1, color: C.red, fontSize: 12, fontWeight: "600" }}>We couldn&apos;t load your permissions.</Txt>
      <PillButton label={retrying ? "Retrying…" : "Retry"} onPress={retrying ? () => {} : retry} />
    </View>
  );
}

type SheetName = "newLoan" | "registerCustomer" | "more" | "search" | "gold" | "reminders" | "profile" | null;

type CollectLauncherProps = { loanId: number | null; onClose: () => void };

// Collect Payment opened from a list or the dashboard: fetch just this loan
// and show its sheet over the current page — no loan-detail navigation.
function CollectLauncher({ loanId, onClose }: CollectLauncherProps) {
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

// openPage() loads a loan before opening its detail, so the page appears with its header filled in.
function usePagePrefetch() {
  const qc = useQueryClient();
  useEffect(() => {
    setPagePrefetch((path) => {
      const cid = path.match(/^\/?(?:\(tabs\)\/)?customers\/(\d+)/)?.[1];
      if (cid) {
        if (qc.getQueryData(["customer", cid])) return null;
        return qc.prefetchQuery({ queryKey: ["customer", cid], queryFn: () => getCustomer(Number(cid)) });
      }
      const id = path.match(/^\/?(?:\(tabs\)\/)?loans\/(\d+)/)?.[1];
      if (!id || qc.getQueryData(["loan", id])) return null;
      return qc.prefetchQuery({ queryKey: ["loan", id], queryFn: () => getLoan(Number(id)) });
    });
    return () => setPagePrefetch(null);
  }, [qc]);
}

// The navigator's props live at module level so a re-render of TabsLayout (every tab change
// re-renders it, via useSegments) hands React Navigation the same functions instead of new ones,
// which made it re-process every page's options.
type TabsProps = React.ComponentProps<typeof Tabs>;

const renderTabBar: NonNullable<TabsProps["tabBar"]> = (props) => <PTabBar {...props} />;

const renderScreenLayout: NonNullable<TabsProps["screenLayout"]> = ({ route, children }) => <RouteGate route={route.name}>{children}</RouteGate>;

const tabScreenOptions: NonNullable<TabsProps["screenOptions"]> = ({ route }) => ({
  headerShown: false,
  sceneStyle: { backgroundColor: "transparent" },
  // A tab keeps its stack when left, so Back can return to the exact
  // page; tapping the tab in the bar resets it to the module root.
  // openPage() (Shell.tsx) switches tabs and resets a tab's stack in
  // one dispatch, so a hidden tab is never rendered mid-flight with
  // stale content to freeze in place — every tab can freeze on blur.
  freezeOnBlur: false,
  // Slide only — no opacity (Android redraws elevation shadows under
  // an animating opacity, which made edges flash).
  // The four primary pages are placed from swipe.pos alone: page i
  // sits at (i - pos) widths, so a tap, a finger swipe and the tab
  // bar all share one position. Other pages keep the navigator slide.
  sceneStyleInterpolator: ({ current }) => {
    const i = PRIMARY_ROUTES.indexOf(route.name);
    const x =
      i >= 0
        ? pageShift[i]
        : current.progress.interpolate({ inputRange: [-1, 0, 1], outputRange: [-SCREEN_W, 0, SCREEN_W] });
    return { sceneStyle: { transform: [{ translateX: x }] } };
  },
  transitionSpec: { animation: "timing", config: { duration: 220, easing: Easing.out(Easing.cubic) } },
});

export default function TabsLayout() {
  // Before any screen below reads its remembered filters: entering a different
  // section clears them (see usePersistedState.ts).
  const segs = useSegments() as string[];
  syncPersistedSection(segs[1] ?? "");
  // The tab swipe only does anything on one of the four primary list pages. Elsewhere (a detail
  // page, a More page) it was still claiming every sideways drag, so a horizontal scroller there —
  // the customer / loan detail tab strip — could scroll one way and then not back. Off there.
  const swipeEnabled = PRIMARY_ROUTES.includes(segs[1] ?? "") && segs.slice(2).every((s) => s === "index");
  useTenantModuleGuard();
  useRoutePermissionGuard();
  usePagePrefetch();
  const swipeHandlers = useTabSwipe();
  const [open, setOpen] = useState<SheetName>(null);
  const close = useCallback(() => setOpen(null), []);
  const [collectLoanId, setCollectLoanId] = useState<number | null>(null);
  // A customer picked from their own page, for the New Loan sheet to start with.
  const [newLoanCustomer, setNewLoanCustomer] = useState<Customer | null>(null);
  const [newLoanDraft, setNewLoanDraft] = useState<LoanDraft | null>(null);
  const closeCollect = useCallback(() => setCollectLoanId(null), []);
  const actions = useMemo<ShellActions>(
    () => ({
      openNewLoan: () => {
        setNewLoanCustomer(null);
        setNewLoanDraft(null);
        setOpen("newLoan");
      },
      openNewLoanDraft: (draft: LoanDraft) => {
        setNewLoanCustomer(null);
        setNewLoanDraft(draft);
        setOpen("newLoan");
      },
      openNewLoanFor: (customer: Customer) => {
        setNewLoanCustomer(customer);
        setNewLoanDraft(null);
        setOpen("newLoan");
      },
      openMore: () => setOpen("more"),
      openSearch: () => setOpen("search"),
      openGoldRate: () => setOpen("gold"),
      openReminders: () => setOpen("reminders"),
      openProfile: () => setOpen("profile"),
      openRegisterCustomer: () => setOpen("registerCustomer"),
      openCollect: (loanId: number) => setCollectLoanId(loanId),
    }),
    []
  );

  return (
    <ShellContext.Provider value={actions}>
      <HeaderHostContext.Provider value>
      <PanGestureHandler {...swipeHandlers} enabled={swipeEnabled}>
      {/* Animated.View: the gesture's native event is attached to this view. */}
      <Animated.View style={{ flex: 1 }} collapsable={false}>
      <Tabs
        // Keep every page mounted and attached: the swipe shows a neighbour before it is focused.
        detachInactiveScreens={false}
        tabBar={renderTabBar}
        // Back walks the pages visited (so a page opened from a quick link
        // returns to where it was opened), rather than jumping to Dashboard.
        backBehavior="history"
        screenLayout={renderScreenLayout}
        screenOptions={tabScreenOptions}
      >
        {/* --- tab bar destinations --- */}
        <Tabs.Screen name="dashboard" options={{ title: "Dashboard", lazy: false }} />
        <Tabs.Screen name="customers" options={{ title: "Customers", lazy: false }} />
        <Tabs.Screen name="loans" options={{ title: "Loans", lazy: false }} />
        <Tabs.Screen name="schemes" options={{ title: "Schemes", lazy: false }} />

        {/* --- reachable from the More sheet ---
            Not `href: null`: Expo Router 58 treats that as "hidden" and drops the route from the
            navigator's visible routes, so focusing one of these pages rendered nothing. Our own
            tab bar only draws the four tabs above, so nothing needs hiding. */}
        <Tabs.Screen name="auctions" options={{ title: "Auctions" }} />
        <Tabs.Screen name="packets" options={{ title: "Packets & Lockers" }} />
        <Tabs.Screen name="banks" options={{ title: "Bank Pledges" }} />
        <Tabs.Screen name="bank-management" options={{ title: "Bank Management" }} />
        <Tabs.Screen name="requests" options={{ title: "Extension & Release" }} />
        <Tabs.Screen name="cash" options={{ title: "Ledger" }} />
        <Tabs.Screen name="personal-loans" options={{ title: "Personal Loans" }} />
        <Tabs.Screen name="investments" options={{ title: "Investments" }} />
        <Tabs.Screen name="reminders" options={{ title: "Reminders" }} />
        <Tabs.Screen name="reports" options={{ title: "Reports" }} />
        <Tabs.Screen name="ledger-statement" options={{ title: "Ledger / Statement" }} />
        <Tabs.Screen name="loan-risk" options={{ title: "Loan Risk" }} />
        <Tabs.Screen name="employees" options={{ title: "Employees" }} />
        <Tabs.Screen name="branches" options={{ title: "Branches" }} />
        <Tabs.Screen name="roles" options={{ title: "Roles & Permissions" }} />
        <Tabs.Screen name="billing" options={{ title: "Billing & Plan" }} />
        <Tabs.Screen name="support" options={{ title: "Support" }} />
      </Tabs>
      {/* One header above every page — see Screen in Shell.tsx. */}
      <HeaderHost />
      <PermissionsFailedBanner />
      </Animated.View>
      </PanGestureHandler>
      </HeaderHostContext.Provider>

      <CreateLoanSheet visible={open === "newLoan"} onClose={close} initialCustomer={newLoanCustomer} initialDraft={newLoanDraft} />
      <MoreSheet visible={open === "more"} onClose={close} onGoldRate={() => setOpen("gold")} />
      <SearchModal visible={open === "search"} onClose={close} />
      <GoldRateModal visible={open === "gold"} onClose={close} />
      <RemindersModal visible={open === "reminders"} onClose={close} />
      <ProfileSheet visible={open === "profile"} onClose={close} />
      {/* Register Customer over the current page, like New Loan; the new profile opens once saved. */}
      <CustomerFormSheet
        visible={open === "registerCustomer"}
        onClose={close}
        onSaved={(c) => {
          if (c?.id) openPage(`/customers/${c.id}`);
        }}
      />
      <CollectLauncher loanId={collectLoanId} onClose={closeCollect} />
    </ShellContext.Provider>
  );
}
