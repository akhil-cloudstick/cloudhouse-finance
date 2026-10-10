import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { ThemedText } from "@/common/components/ui/ThemedText";
import { Icon } from "@/common/components/ui/Icon";
import { colors } from "@/common/theme/colors";

// Ported from mobile/src/components/AppTabBar.tsx for the customer app's 5
// Batch 1 destinations — Home is real, the other four are ComingSoon stubs
// (see app/(tabs)/_layout.tsx) but are wired as real routes now so nothing
// needs restructuring when their batches land. Styling matches the staff
// app's bar exactly: a flush full-width footer, not a floating "island"
// card, so both apps present the same bottom nav.
const TABS: [string, string, string][] = [
  ["index", "Home", "home"],
  ["loans", "My Loans", "note"],
  ["payments", "Payments", "coin"],
  ["documents", "Documents", "doc"],
  ["more", "Profile", "user"],
];

export function AppTabBar({ state, navigation, insets }: BottomTabBarProps) {
  const activeRouteName = state.routes[state.index]?.name;

  function onTabPress(name: string) {
    const route = state.routes.find((r) => r.name === name);
    if (!route) return;
    const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
    if (event.defaultPrevented) return;
    if (route.name !== activeRouteName) {
      navigation.navigate(route.name);
    }
  }

  return (
    // paddingBottom covers the Android gesture pill / iOS home indicator —
    // the app draws edge-to-edge, so without this the bar sat flush against
    // the very bottom of the screen with nothing protecting it.
    <View style={[styles.wrap, { paddingBottom: insets.bottom }]}>
      <View style={styles.island}>
        {TABS.map(([name, label, icon]) => {
          const isActive = name === activeRouteName;
          return (
            <Pressable key={name} onPress={() => onTabPress(name)} style={styles.item}>
              <View style={[styles.iconWrap, isActive && styles.iconWrapActive]}>
                <Icon name={icon} size={21} color={isActive ? colors.brandDeep : colors.muted} />
              </View>
              <ThemedText variant="label" color={isActive ? colors.brandDeep : colors.muted} numberOfLines={1}>
                {label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 0, paddingTop: 0, backgroundColor: colors.card },
  // Flush full-width footer bar — no floating "island" card, no gap from
  // the background behind it (wrap and island share the same fill), same as
  // mobile/src/components/AppTabBar.tsx.
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
  // A rectangular chip highlight (wider than tall, softly rounded corners)
  // behind just the icon, not a circle. overflow hidden keeps Android's
  // default rectangular Pressable ripple from spilling past the corners.
  iconWrap: { width: 52, height: 30, borderRadius: 8, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  // WhatsApp-style active state: a filled pill highlight behind just the
  // icon, not an outline around the whole item.
  iconWrapActive: { backgroundColor: colors.brandPale },
});
