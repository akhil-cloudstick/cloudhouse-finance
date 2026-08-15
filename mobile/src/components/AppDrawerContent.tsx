import React from "react";
import { View, Pressable, StyleSheet, ScrollView } from "react-native";
// expo-router/drawer re-exports this type itself (from its own vendored
// react-navigation/drawer) — @react-navigation/drawer isn't a direct
// dependency of this project, so importing from it doesn't resolve.
import { DrawerContentComponentProps } from "expo-router/drawer";
import { ThemedText } from "./ThemedText";
import { colors } from "../theme/colors";
import { useAuth, useIsAdministrator } from "../auth/AuthContext";

// Grouped sidebar content — mirrors frontend/components/Sidebar.tsx's NAV
// sections so the mobile drawer is organized the same way instead of one
// long flat list of every module.
const GROUPS: [string, string[]][] = [
  ["Overview", ["dashboard", "reminders", "reports"]],
  ["Lending", ["loans", "schemes", "gold-rates"]],
  ["Customers", ["customers"]],
  ["Gold Custody", ["packets", "lockers", "banks", "auctions"]],
  ["Operations", ["cash", "employees"]],
  // "purity-standards" intentionally removed — it's now launched as a modal
  // from gold-rates.tsx (mobile/src/components/PurityStandardsModal.tsx)
  // rather than being its own drawer destination; the route file itself is
  // left in place (app/(drawer)/purity-standards.tsx) since removing it
  // would also require touching _layout.tsx's Drawer.Screen registration.
  ["Administration", ["ornament-types", "settings", "branches"]],
];

export function AppDrawerContent(props: DrawerContentComponentProps) {
  const { state, descriptors, navigation } = props;
  const { employee, signOut } = useAuth();
  const isAdmin = useIsAdministrator();

  const activeRouteName = state.routes[state.index]?.name;

  return (
    <View style={styles.container}>
      <View style={styles.brand}>
        <ThemedText variant="h3" color={colors.goldDeep}>
          Ambika Gold Finance
        </ThemedText>
        <ThemedText variant="small" color={colors.muted}>
          {employee?.name} · {employee?.role}
        </ThemedText>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {GROUPS.map(([group, names]) => {
          const routes = names
            .map((n) => state.routes.find((r) => r.name === n))
            .filter((r: (typeof state.routes)[number] | undefined): r is (typeof state.routes)[number] => {
              if (!r) return false;
              // employees/settings/branches are admin-only — hidden the same way
              // the previous flat drawer hid them (drawerItemStyle: none).
              if ((r.name === "employees" || r.name === "settings" || r.name === "branches") && !isAdmin) return false;
              return true;
            });
          if (!routes.length) return null;

          return (
            <View key={group} style={styles.group}>
              <ThemedText variant="label" color={colors.muted} style={styles.groupLabel}>
                {group.toUpperCase()}
              </ThemedText>
              <View style={styles.island}>
                {routes.map((route, i) => {
                  const { options } = descriptors[route.key];
                  const label = (options.drawerLabel as string) ?? options.title ?? route.name;
                  const isActive = route.name === activeRouteName;
                  return (
                    <Pressable
                      key={route.key}
                      onPress={() => navigation.navigate(route.name)}
                      style={[
                        styles.item,
                        isActive && styles.itemActive,
                        i > 0 && styles.itemDivider,
                      ]}
                    >
                      {/* Same "body" variant/font for every row, active or not — only
                          color and background change on selection. */}
                      <ThemedText variant="body" color={isActive ? colors.goldDeep : colors.ink}>
                        {label}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <Pressable onPress={signOut} style={styles.signOut}>
        <ThemedText variant="label" color={colors.red}>
          ← Sign out
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.card },
  brand: {
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  scroll: { paddingVertical: 12, paddingHorizontal: 14 },
  // Each group is its own rounded "island" card, with real gaps between
  // islands — previously every group ran together as one long flat list.
  group: { marginBottom: 18 },
  groupLabel: { paddingHorizontal: 6, marginBottom: 6, letterSpacing: 0.5 },
  island: {
    backgroundColor: colors.ivory,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  item: { paddingHorizontal: 16, paddingVertical: 12 },
  itemDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  itemActive: { backgroundColor: colors.goldPale },
  signOut: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
});
