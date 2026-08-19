import React from "react";
import { View, Pressable, StyleSheet, Platform } from "react-native";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { ThemedText } from "./ThemedText";
import { Icon } from "./Icon";
import { colors } from "../theme/colors";

// Ported/trimmed from mobile/src/components/AppTabBar.tsx for the customer
// app's 5 Batch 1 destinations — Home is real, the other four are
// ComingSoon stubs (see app/(tabs)/_layout.tsx) but are wired as real routes
// now so nothing needs restructuring when their batches land.
const TABS: [string, string, string][] = [
  ["index", "Home", "home"],
  ["loans", "My Loans", "note"],
  ["payments", "Payments", "coin"],
  ["documents", "Documents", "doc"],
  ["more", "More", "dots"],
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
    <View style={[styles.wrap, { paddingBottom: 0 }]}>
      <View style={styles.island}>
        {TABS.map(([name, label, icon]) => {
          const isActive = name === activeRouteName;
          return (
            <Pressable key={name} onPress={() => onTabPress(name)} style={[styles.item, isActive && styles.itemActive]}>
              <View style={styles.iconWrap}>
                <Icon name={icon} size={21} color={isActive ? colors.goldDeep : colors.muted} />
              </View>
              <ThemedText variant="label" color={isActive ? colors.goldDeep : colors.muted} numberOfLines={1}>
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
  wrap: { paddingHorizontal: 4, paddingTop: 0, backgroundColor: colors.ivory },
  island: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 6,
    paddingHorizontal: 6,
    gap: 2,
    ...Platform.select({
      ios: { shadowColor: colors.charcoal, shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: -2 } },
      android: { elevation: 4 },
    }),
  },
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "transparent",
  },
  itemActive: { backgroundColor: "transparent", borderColor: colors.goldDeep },
  iconWrap: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
});
