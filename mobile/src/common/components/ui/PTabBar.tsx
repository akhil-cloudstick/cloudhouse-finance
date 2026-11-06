import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigationContainerRef } from "expo-router";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { C } from "./base";
import { Fade } from "./Fade";
import { Spinner } from "./Spinner";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { PTAB_HEIGHT, PTAB_INSET, tabBarLift } from "@/common/theme/layout";
import { useAuth } from "@/common/providers/AuthProvider";
import { useKeyboardVisible } from "@/common/hooks/use-keyboard-visible";
import { routeAllowed } from "@/common/config/routePermissions";
import { useMoreRows } from "@/common/components/layout/moreRows";
import { tabsRef, useShell, focusTab, s, coverStore, headerStore, type TabsNav, type TabsState } from "./shellContext";
import { PRIMARY_ROUTES, showPage, swipe, tabLit, tabScale } from "./swipeStore";
import { dropPendingFocus, leftOnDetail, scheduleStaleRootReset } from "./swipeController";

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
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: C.bg, opacity: fade, alignItems: "center", justifyContent: "center" }]}>
      <Spinner size={34} color={C.brandDeep} />
    </Animated.View>
  );
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

type AnyNavState = { type?: string; routeNames?: string[]; routes?: { name: string; state?: AnyNavState }[] };
/** The tab router's own state inside the root navigation state. Found by its route names: Expo
 * Router 58's tree states carry no `type`, so matching on `type === "tab"` never found it. */
function findTabsState(root: AnyNavState | undefined): TabsState | undefined {
  if (!root) return undefined;
  if (PRIMARY_ROUTES.every((n) => root.routeNames?.includes(n))) return root as unknown as TabsState;
  for (const r of root.routes ?? []) {
    const found = findTabsState(r.state);
    if (found) return found;
  }
  return undefined;
}
/** .tabbar + .tabfade — Dashboard / Customers / Loans (centre FAB) / Schemes / More. */
export function PTabBar({ state: viewState, emitter, navigateToTab }: BottomTabBarProps) {
  // Expo Router 58 gives the tab bar no `navigation`, and only a trimmed copy of the state (no
  // key / routeNames / routeKeySeq / stale, which a RESET payload must now carry). Both come
  // from the navigation container instead: the real tabs state, and a dispatch aimed at the
  // tabs navigator by its state key.
  const container = useNavigationContainerRef();
  // The tab bar renders from its own state, as it always has in practice: the lookup below never
  // matched before (see findTabsState), so this was already the state in use. The real tree state
  // is read only when it is needed — minting new route keys (tabRouteMinter) — when it is current.
  const state = viewState as unknown as TabsState;
  const navigation: TabsNav = {
    dispatch: (action) => container.dispatch({ target: state.key, ...action }),
    navigate: (name) => {
      const route = state.routes.find((r) => r.name === name);
      if (route) navigateToTab(route.key);
    },
  };
  useLayoutEffect(() => {
    tabsRef.nav = navigation;
    tabsRef.state = state;
    tabsRef.live = () => findTabsState(container.getRootState());
    scheduleStaleRootReset();
  });
  // Expo Router 58 keeps only visited tabs in the navigator's state, and an unvisited tab is not
  // drawn at all. `lazy: false` asks the router to PRELOAD the swipe pages; make sure every one of
  // them is there, so a swipe never slides onto an empty, undrawn page.
  useEffect(() => {
    for (const name of PRIMARY_ROUTES) {
      if (!state.routes.some((r) => r.name === name)) navigation.dispatch({ type: "PRELOAD", payload: { name } });
    }
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

  // Follow the active tab with the shared swipe position: a tap glides the
  // highlight across, and a finger swipe drives it directly (see swipeController).
  const activeIdx = PRIMARY_ROUTES.indexOf(activeRoute);
  const parked = useRef(false);
  useEffect(() => {
    if (activeIdx < 0) {
      // A More page slid over the primary pages: park them off-screen once it has landed.
      const t = setTimeout(() => {
        swipe.pos.setValue(-5);
        swipe.page = -5;
        parked.current = true;
      }, 260);
      return () => clearTimeout(t);
    }
    if (parked.current) {
      parked.current = false;
      swipe.page = activeIdx;
      swipe.pos.setValue(activeIdx);
    } else if (!swipe.active) {
      showPage(activeIdx);
    }
  }, [activeIdx]);

  function go(name: string) {
    const route = state.routes.find((r) => r.name === name);
    if (!route) return;
    // A tap overrides a swipe whose tab focus is still waiting (see swipeController).
    const swipedTo = dropPendingFocus();
    if (route.name !== navRoute) {
      setPressed(route.name);
      // The title changes with the tap, not when the page finishes rendering.
      if (PRIMARY_ROUTES.includes(route.name)) headerStore.preview(route.name);
    } else if (swipedTo >= 0 && PRIMARY_ROUTES.includes(route.name)) {
      // A swipe moved off this (still focused) tab: bring the pages back to it.
      headerStore.preview(route.name);
      showPage(PRIMARY_ROUTES.indexOf(route.name));
    }
    // A tab still on a detail page is swapped for its list right away, so the list is what
    // slides in; otherwise navigation follows on the next frame (see `pressed` above).
    if (route.name !== navRoute && leftOnDetail(route)) navigateTo(route);
    else requestAnimationFrame(() => navigateTo(route));
  }

  function navigateTo(route: (typeof state.routes)[number]) {
    const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
    if (event.defaultPrevented) return setPressed(null);
    // Always land on the tab's root list (a deep push, or a page opened
    // from another tab, can leave the nested stack parked on a detail).
    const nested = route.state;
    if (nested?.type === "stack" && (nested.routes?.[0]?.name !== "index" || (route.name !== navRoute && leftOnDetail(route)))) {
      // The tab is on a detail page (opened via openPage(), whose stack key in this state may
      // be stale — see focusTab — or pushed from its list). Swap the stack for a fresh list
      // and focus the tab in one step, through the tabs navigator itself, so the old detail
      // never shows first.
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
          const i = PRIMARY_ROUTES.indexOf(t.route);
          if (t.fab) {
            return (
              <Pressable key={t.route} style={s.tabFab} onPressIn={() => go(t.route)} accessibilityLabel={t.label}>
                <Animated.View
                  style={[
                    s.tabFabIc,
                    { transform: [{ scale: tabScale[i] }] },
                  ]}
                >
                  <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: 26, backgroundColor: C.brand, opacity: tabLit[i] }]} />
                  <PIcon name={t.icon} color="#fff" />
                </Animated.View>
              </Pressable>
            );
          }
          return (
            <Pressable key={t.route} style={s.tab} onPressIn={() => go(t.route)} accessibilityLabel={t.label}>
              <View style={s.tabIc}>
                <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, s.tabIcActive, { opacity: tabLit[i] }]} />
                <PIcon name={t.icon} color={C.muted} />
                <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, s.tabIcOverlay, { opacity: tabLit[i] }]}>
                  <PIcon name={t.icon} color={C.brandDeep} />
                </Animated.View>
              </View>
              <View>
                <Txt style={s.tabLbl}>{t.label}</Txt>
                <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: tabLit[i] }]}>
                  <Txt style={[s.tabLbl, s.tabLblActive]}>{t.label}</Txt>
                </Animated.View>
              </View>
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
