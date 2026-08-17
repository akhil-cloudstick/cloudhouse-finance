import React from "react";
import { View, Pressable, StyleSheet, Platform } from "react-native";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { ThemedText } from "./ThemedText";
import { Icon } from "./Icon";
import { colors } from "../theme/colors";
import { useMoreSheet } from "./MoreSheet";

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
const TABS: [string, string, string][] = [
  // [route name, label, icon]
  ["dashboard", "Dashboard", "home"],
  ["loans", "Loans", "note"],
  ["customers", "Customers", "user"],
  ["packets", "Packets", "box"],
];

export function AppTabBar({ state, navigation, insets }: BottomTabBarProps) {
  const { open } = useMoreSheet();
  const activeRouteName = state.routes[state.index]?.name;

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
    // the app draws edge-to-edge, which SDK 57+ enforces.
    <View style={[styles.wrap, { paddingBottom: insets.bottom + 8 }]}>
      <View style={styles.island}>
        {TABS.map(([name, label, icon]) => {
          const isActive = name === activeRouteName;
          return (
            <Pressable
              key={name}
              onPress={() => onTabPress(name)}
              style={[styles.item, isActive && styles.itemActive]}
            >
              <Icon name={icon} size={21} color={isActive ? colors.goldDeep : colors.muted} />
              <ThemedText variant="label" color={isActive ? colors.goldDeep : colors.muted} numberOfLines={1}>
                {label}
              </ThemedText>
            </Pressable>
          );
        })}

        {/* Not a route — raises the More sheet over whatever screen is on. */}
        <Pressable onPress={open} style={styles.item}>
          <Icon name="dots" size={21} color={colors.muted} />
          <ThemedText variant="label" color={colors.muted}>
            More
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 0, backgroundColor: colors.ivory },
  // Same floating "island" language as FloatingHeader — card fill, gold-tinted
  // hairline border, soft lift.
  island: {
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 6,
    paddingHorizontal: 6,
    gap: 2,
    ...Platform.select({
      ios: {
        shadowColor: colors.charcoal,
        shadowOpacity: 0.12,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: -2 },
      },
      android: { elevation: 4 },
    }),
  },
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingVertical: 7,
    borderRadius: 14,
  },
  itemActive: { backgroundColor: colors.goldPale },
});
