import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { ThemedText } from "@/common/components/ui/ThemedText";
import { Icon } from "@/common/components/ui/Icon";
import { colors } from "@/common/theme/colors";

const TABS: [string, string, string][] = [
  ["index", "Home", "home"],
  ["loans", "My Loans", "note"],
  ["payments", "Payments", "coin"],
  ["documents", "Documents", "doc"],
  ["more", "Profile", "user"],
];

// Expo Router 58 gives the tab bar an emitter and navigateToTab(routeKey) in place of `navigation`.
export function AppTabBar({ state, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const activeRouteName = state.routes[state.index]?.name;

  function onTabPress(name: string) {
    const route = state.routes.find((r) => r.name === name);
    if (!route) return;
    const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
    if (event.defaultPrevented) return;
    if (route.name !== activeRouteName) {
      navigateToTab(route.key);
    }
  }

  return (
    // paddingBottom protects against the Android gesture pill / iOS home indicator since the app draws edge-to-edge.
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
  // overflow hidden keeps Android's rectangular Pressable ripple from spilling past the rounded corners.
  iconWrap: { width: 52, height: 30, borderRadius: 8, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  iconWrapActive: { backgroundColor: colors.brandPale },
});
