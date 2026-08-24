import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { ThemedText } from "./ThemedText";
import { Icon } from "./Icon";
import { colors } from "../theme/colors";
import { useMoreSheet } from "./MoreSheet";
import { useAuth } from "../auth/AuthContext";

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
  { route: "new-loan", label: "New Loan", icon: "plus", module: "Loan_Management", key: "can_change_loan" },
];

export function AppTabBar({ state, navigation, insets }: BottomTabBarProps) {
  const { open } = useMoreSheet();
  const { can } = useAuth();
  const activeRouteName = state.routes[state.index]?.name;
  const visibleTabs = TABS.filter((t) => t.module === null || can(t.module, t.key!));

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

  return (
    // In normal flow, not absolutely positioned: the tab navigator lays the
    // custom tabBar out below the scene (BottomTabView is a flex column), so
    // it reserves its own height and no screen needs extra bottom padding.
    // paddingBottom covers the Android gesture pill / iOS home indicator —
    // the app draws edge-to-edge, which SDK 57+ enforces, so without this the
    // bar sat flush against the very bottom of the screen with nothing
    // protecting it from the gesture nav / home indicator.
    <View style={[styles.wrap, { paddingBottom: insets.bottom }]}>
      <View style={styles.island}>
        {visibleTabs.map(({ route: name, label, icon }) => {
          const isActive = name === activeRouteName;
          return (
            <Pressable key={name} onPress={() => onTabPress(name)} style={styles.item}>
              <View style={[styles.iconWrap, isActive && styles.iconWrapActive]}>
                <Icon name={icon} size={21} color={isActive ? colors.goldDeep : colors.muted} />
              </View>
              <ThemedText variant="label" color={isActive ? colors.goldDeep : colors.muted} numberOfLines={1}>
                {label}
              </ThemedText>
            </Pressable>
          );
        })}

        {/* Not a route — raises the More sheet over whatever screen is on. */}
        <Pressable onPress={open} style={styles.item}>
          <View style={styles.iconWrap}>
            <Icon name="dots" size={21} color={colors.muted} />
          </View>
          <ThemedText variant="label" color={colors.muted}>
            More
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 0, paddingTop: 0, backgroundColor: colors.card },
  // Flush full-width footer bar — no floating "island" card, no gap from
  // the background behind it (wrap and island share the same fill).
  island: {
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingVertical: 4,
    paddingHorizontal: 6,
    gap: 2,
  },
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 0,
    paddingVertical: 0,
  },
  // Square box + radius === half the side, and overflow hidden so Android's
  // default rectangular Pressable ripple can't paint square over it — a
  // true circle, not a stadium/rounded-rect.
  iconWrap: { width: 36, height: 36, borderRadius: 18, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  // WhatsApp-style active state: a filled pill highlight behind just the
  // icon, not an outline around the whole item.
  iconWrapActive: { backgroundColor: colors.goldPale },
});
