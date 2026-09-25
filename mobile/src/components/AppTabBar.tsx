import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Icon } from "./Icon";
import { colors } from "../theme/colors";
import { TAB_BAR_FADE, TAB_BAR_HEIGHT } from "../theme/layout";
import { useMoreSheet } from "./MoreSheet";
import { useAuth } from "../auth/AuthContext";
import { useTheme } from "../theme/ThemeProvider";

// Bottom bar for the (tabs) group — replaces the old side drawer
// (AppDrawerContent). Four primary destinations plus a "More" slot that
// raises the MoreSheet with every other module.
//
// Icons are the web admin UI's glyphs (Icon.tsx / frontend/lib/icons.tsx),
// matching frontend/components/Sidebar.tsx's NAV: dashboard→home,
// customers→user, packets→box. Loans is the one deviation — `note`
// (banknote) rather than the web's `list`, because at tab-bar size a row of
// lines reads as "a list" rather than "money lent", and `list` is also the
// ☰ glyph FloatingHeader uses.
// module/key: null means always visible (Dashboard) — every other tab is
// filtered by the real permission, mirroring MoreSheet.tsx and
// frontend/common/components/layout/Sidebar.tsx's NAV (§12).
const TABS: { route: string; label: string; icon: string; module: string | null; key?: string }[] = [
  { route: "dashboard", label: "Dashboard", icon: "home", module: null },
  { route: "loans", label: "Loans", icon: "note", module: "Loan_Management", key: "can_view_loan" },
  { route: "customers", label: "Customers", icon: "user", module: "Customer_Management", key: "can_view_customer" },
  { route: "new-loan", label: "New Loan", icon: "plus", module: "Loan_Management", key: "can_create_loan" },
];

export function AppTabBar({ state, navigation, insets }: BottomTabBarProps) {
  const { colors } = useTheme();
  const { open } = useMoreSheet();
  const { can } = useAuth();
  const activeRouteName = state.routes[state.index]?.name;
  const visibleTabs = TABS.filter((t) => t.module === null || can(t.module, t.key!));
  // Every screen reachable only via the More sheet (Reminders, Reports,
  // Settings, ...) is still one of this navigator's routes — just not one of
  // the 4 primary TABS — so "the More slot is active" is exactly "the
  // current route isn't one of those 4".
  const isMoreActive = !TABS.some((t) => t.route === activeRouteName);

  function onTabPress(name: string) {
    const route = state.routes.find((r) => r.name === name);
    if (!route) return;

    const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
    if (event.defaultPrevented) return;

    // Land on that tab's own root, whether we're switching into it or
    // re-tapping while already on it. Switching matters just as much as
    // re-tapping: a deep push from another tab (e.g. Dashboard's "review"
    // link into a loan) leaves the Loans tab's nested Stack with the detail
    // screen as its only entry, and merely navigating to the tab shows
    // whatever's on top of that stack — it doesn't reset it. `POP_TO_TOP` is
    // dispatched as a raw action because expo-router's vendored
    // react-navigation doesn't re-export StackActions publicly; the shape is
    // what StackActions.popToTop() produces, and `target` aims it at the
    // nested Stack rather than the tab navigator.
    const nested = route.state;
    if (nested?.type === "stack" && nested.key && (nested.index ?? 0) > 0) {
      navigation.dispatch({ type: "POP_TO_TOP", target: nested.key });
    }

    if (route.name !== activeRouteName) {
      navigation.navigate(route.name);
    }
  }

  const center = visibleTabs.find((t) => t.route === "new-loan");
  const sideTabs = visibleTabs.filter((t) => t.route !== "new-loan");
  // Two slots either side of the raised centre button; "More" is always last.
  const slots: ({ route: string; label: string; icon: string } | "more")[] = [...sideTabs, "more"];
  const left = center ? slots.slice(0, Math.ceil(slots.length / 2)) : slots;
  const right = center ? slots.slice(Math.ceil(slots.length / 2)) : [];

  function renderSlot(slot: (typeof slots)[number]) {
    if (slot === "more") {
      return (
        // Not a route — raises the More sheet over whatever screen is on.
        <Pressable key="more" onPressIn={open} style={styles.item} accessibilityLabel="More" hitSlop={6}>
          {({ pressed }) => (
            <View style={[styles.circle, (pressed || isMoreActive) && { backgroundColor: colors.brandPale }]}>
              <Icon name="dots" size={24} color={pressed || isMoreActive ? colors.brandDeep : colors.muted} />
            </View>
          )}
        </Pressable>
      );
    }
    const isActive = slot.route === activeRouteName;
    return (
      // onPressIn (not onPress) so the switch starts the moment the finger lands.
      <Pressable key={slot.route} onPressIn={() => onTabPress(slot.route)} style={styles.item} accessibilityLabel={slot.label} hitSlop={6}>
        <View style={[styles.circle, isActive && { backgroundColor: colors.brandPale }]}>
          <Icon name={slot.icon} size={24} color={isActive ? colors.brandDeep : colors.muted} />
        </View>
      </Pressable>
    );
  }

  return (
    // Floats over the scene (absolute) with no background of its own: the page
    // shows through and fades out gradually across the bar's full height
    // (the gradient below). box-none lets taps on that faded area reach the
    // page. Scroll content pads its bottom by TAB_BAR_SPACE to clear the bar.
    // paddingBottom clears the gesture pill / home indicator.
    <View style={[styles.wrap, { paddingBottom: insets.bottom }]} pointerEvents="box-none">
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="tabBarFade" x1="0" y1="0" x2="0" y2="1">
              {FADE_STOPS.map((s) => (
                <Stop key={s} offset={s} stopColor={colors.bg} stopOpacity={s} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#tabBarFade)" />
        </Svg>
      </View>
      <View style={styles.island}>
        {left.map(renderSlot)}
        {center ? (
          <View style={styles.centerSlot}>
            <Pressable
              onPressIn={() => onTabPress(center.route)}
              style={({ pressed }) => [styles.centerBtn, { backgroundColor: colors.brandDeep, shadowColor: colors.brandDeep }, pressed && { transform: [{ scale: 0.94 }] }]}
              accessibilityLabel={center.label}
            >
              <Icon name={center.icon} size={28} color={colors.card} />
            </Pressable>
          </View>
        ) : null}
        {right.map(renderSlot)}
      </View>
    </View>
  );
}

const CENTER = 62;
// Opacity climbs in 20 equal small steps from clear (top) to solid (bottom).
const FADE_STOPS = Array.from({ length: 21 }, (_, i) => i / 20);

const styles = StyleSheet.create({

  // paddingTop is the fade zone above the bar (the gradient spans the whole wrap).
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingTop: TAB_BAR_FADE },
  island: {
    flexDirection: "row",
    alignItems: "center",
    height: TAB_BAR_HEIGHT,
    backgroundColor: colors.card,
    borderRadius: 26,
    paddingHorizontal: 8,
    // boxShadow, not elevation: Android's elevation shadow drew a stray
    // rectangle beneath the rounded bar. boxShadow follows the border radius.
    boxShadow: "0px 6px 16px rgba(43, 26, 94, 0.12)",
  },
  item: { flex: 1, height: "100%", alignItems: "center", justifyContent: "center" },
  // Rounded rectangle (not a full circle); overflow hidden so Android always
  // clips the highlight to the rounded corners after a re-render.
  circle: { width: 54, height: 40, borderRadius: 14, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  centerSlot: { flex: 1, alignItems: "center" },
  // Raised above the bar; the page-coloured ring fakes the notch in the reference design.
  centerBtn: {
    width: CENTER,
    height: CENTER,
    borderRadius: CENTER / 2,
    marginTop: -CENTER * 0.72,
    borderWidth: 5,
    borderColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
});
