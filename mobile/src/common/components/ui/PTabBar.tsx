import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { C } from "./base";
import { Fade } from "./Fade";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { PTAB_HEIGHT, PTAB_INSET, tabBarLift } from "@/common/theme/layout";
import { useAuth } from "@/common/providers/AuthProvider";
import { useKeyboardVisible } from "@/common/hooks/use-keyboard-visible";
import { routeAllowed } from "@/common/config/routePermissions";
import { useMoreRows } from "@/common/components/layout/moreRows";
import { tabsRef, useShell, focusTab, s, coverStore } from "./shellContext";

function NavCover() {
  const phase = useSyncExternalStore(coverStore.subscribe, coverStore.get, coverStore.get);
  const [fade] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (phase === "on") fade.setValue(1);
    else if (phase === "leaving") {
      Animated.timing(fade, { toValue: 0, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(({ finished }) => {
        if (finished) coverStore.set("off");
      });
    }
  }, [phase, fade]);
  if (phase === "off") return null;
  return <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: C.bg, opacity: fade }]} />;
}
// ---------------------------------------------------------------------------
// Bottom tab bar
// ---------------------------------------------------------------------------

type TabDef = { route: string; label: string; icon: string; fab?: boolean };
// Each tab's permission comes from ROUTE_PERMISSIONS (routeAllowed below).
const TABS: TabDef[] = [
  { route: "dashboard", label: "Dashboard", icon: "home" },
  { route: "customers", label: "Customers", icon: "user" },
  { route: "loans", label: "Loans", icon: "note", fab: true },
  { route: "schemes", label: "Schemes", icon: "layers" },
];
// How far the tab bar's fade reaches above the bar itself.
const TAB_FADE_ABOVE = 36;
/** .tabbar + .tabfade — Dashboard / Customers / Loans (centre FAB) / Schemes / More. */
export function PTabBar({ state, navigation }: BottomTabBarProps) {
  useLayoutEffect(() => {
    tabsRef.nav = navigation;
    tabsRef.state = state;
  });
  const keyboardUp = useKeyboardVisible();
  const insets = useSafeAreaInsets();
  const { openMore } = useShell();
  const { can } = useAuth();
  const navRoute = state.routes[state.index]?.name;
  // The tapped tab lights up on touch-down, before the (heavier) new page
  // renders: the highlight commits first and navigation follows on the next
  // frame, so bar and page change together instead of the bar lagging.
  const [pressed, setPressed] = useState<string | null>(null);
  // Navigation has caught up with the tap: drop the early highlight. Done
  // during render (React's "adjust state when a value changes" pattern), not
  // in an effect — an effect would paint once with the stale value and then
  // re-render, which is exactly the cascade the lint rule flags.
  if (pressed && pressed === navRoute) setPressed(null);
  const activeRoute = pressed && pressed !== navRoute ? pressed : navRoute;
  const tabs = TABS.filter((t) => routeAllowed(t.route, can));
  const hasMore = useMoreRows().length > 0;
  const isPrimary = tabs.some((t) => t.route === activeRoute);

  function go(name: string) {
    const route = state.routes.find((r) => r.name === name);
    if (!route) return;
    if (route.name !== navRoute) setPressed(route.name);
    requestAnimationFrame(() => navigateTo(route));
  }

  function navigateTo(route: (typeof state.routes)[number]) {
    const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
    if (event.defaultPrevented) return setPressed(null);
    // Always land on the tab's root list (a deep push, or a page opened
    // from another tab, can leave the nested stack parked on a detail).
    const nested = route.state;
    if (nested?.type === "stack" && nested.routes?.[0]?.name !== "index") {
      // Opened via openPage(): the stack holds only a detail page, and its
      // key in this state may be stale (see focusTab). Swap it for the list
      // and focus the tab in one step, through the tabs navigator itself.
      focusTab(navigation, state, state.routes.indexOf(route), { stack: { name: "index" } });
      if (route.name === navRoute) setPressed(null);
      return;
    }
    if (nested?.type === "stack" && nested.key && (nested.index ?? 0) > 0) {
      // A stack with the list at its root got here by pushes made inside
      // it, so its navigator has reported its real key — safe to target.
      navigation.dispatch({ type: "POP_TO_TOP", target: nested.key });
    }
    if (route.name !== navRoute) navigation.navigate(route.name);
    else setPressed(null);
  }

  // Hidden while typing: on devices where the window resizes for the
  // keyboard, the bottom-anchored bar would otherwise ride up above it.
  if (keyboardUp) return <NavCover />;

  return (
    <>
      <NavCover />
      {/* Gradual fade covering the bar's full height plus a strip above it,
          so content eases out before it reaches the bar instead of meeting
          a hard edge. */}
      <Fade from="bottom" height={PTAB_INSET + PTAB_HEIGHT + TAB_FADE_ABOVE + tabBarLift(insets.bottom)} solidAt={0.6} style={s.tabFade} />
      <View style={[s.tabbar, { bottom: PTAB_INSET + tabBarLift(insets.bottom) }]}>
        {tabs.map((t) => {
          const active = t.route === activeRoute;
          if (t.fab) {
            return (
              <Pressable key={t.route} style={s.tabFab} onPressIn={() => go(t.route)} accessibilityLabel={t.label}>
                <View style={[s.tabFabIc, active && s.tabFabIcActive]}>
                  <PIcon name={t.icon} color="#fff" />
                </View>
              </Pressable>
            );
          }
          return (
            <Pressable key={t.route} style={s.tab} onPressIn={() => go(t.route)} accessibilityLabel={t.label}>
              <View style={[s.tabIc, active && s.tabIcActive]}>
                <PIcon name={t.icon} color={active ? C.brandDeep : C.muted} />
              </View>
              <Txt style={[s.tabLbl, active && s.tabLblActive]}>{t.label}</Txt>
            </Pressable>
          );
        })}
        {hasMore ? (
          <Pressable style={s.tab} onPressIn={openMore} accessibilityLabel="More">
            <View style={[s.tabIc, !isPrimary && s.tabIcActive]}>
              <PIcon name="dots" color={!isPrimary ? C.brandDeep : C.muted} />
            </View>
            <Txt style={[s.tabLbl, !isPrimary && s.tabLblActive]}>More</Txt>
          </Pressable>
        ) : null}
      </View>
    </>
  );
}
