import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { View, Pressable, StyleSheet, ScrollView } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { ThemedText } from "./ThemedText";
import { BottomSheetModal } from "./BottomSheetModal";
import { Icon } from "./Icon";
import { colors } from "../theme/colors";
import { useAuth, useIsAdministrator } from "../auth/AuthContext";

// The "More" destination for the bottom bar — every module that isn't one of
// the four primary tabs. Replaces the old side drawer (AppDrawerContent):
// same section grouping that frontend/components/Sidebar.tsx uses, same
// rounded-island styling, same admin gate, but raised as a bottom sheet from
// the bar's 5th slot (or the ☰ button in FloatingHeader) instead of sliding
// in from the left.
//
// Icons are the web admin UI's own glyphs (src/components/Icon.tsx, ported
// from frontend/lib/icons.tsx) so the two apps name the same page with the
// same picture.
const GROUPS: [string, [string, string, string][]][] = [
  // [section, [route, label, icon]]
  [
    "Overview",
    [
      ["reminders", "Reminders", "cal"],
      ["reports", "Reports", "chart"],
    ],
  ],
  [
    "Lending",
    [
      ["schemes", "Schemes", "doc"],
      // `coin` belongs to Cash & Expenses; Gold Rates gets the balance
      // scale (rate per gram) so the two rows aren't the same glyph.
      ["gold-rates", "Gold Rates", "scale"],
    ],
  ],
  [
    "Gold Custody",
    [
      ["packets", "Packets", "box"],
      ["lockers", "Lockers", "lock"],
      ["banks", "Bank Pledge", "bank"],
      ["auctions", "Auctions", "gavel"],
    ],
  ],
  [
    "Operations",
    [
      ["cash", "Cash & Expenses", "coin"],
      ["employees", "Employees", "user"],
    ],
  ],
  [
    "Administration",
    [
      // "purity-standards" is its own destination: the "Purity standards"
      // button that used to launch it as a modal from gold-rates.tsx was
      // removed, so this row is the only way in.
      ["purity-standards", "Purity Standards", "shield"],
      ["settings", "Settings", "gear"],
      ["branches", "Branches", "bank"],
    ],
  ],
];

// employees/settings/branches are admin-only — the same gate the drawer
// applied via drawerItemStyle: none.
const ADMIN_ONLY = new Set(["employees", "settings", "branches"]);

const MoreSheetContext = createContext<{ open: () => void }>({ open: () => {} });

/** Opens the More sheet. Available to anything inside the (tabs) group. */
export function useMoreSheet() {
  return useContext(MoreSheetContext);
}

// One sheet instance for the whole tab group, so the tab bar's "More" slot
// and every screen's header ☰ drive the same thing instead of each holding
// its own copy of the modal.
export function MoreSheetProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const open = useCallback(() => setVisible(true), []);
  const value = useMemo(() => ({ open }), [open]);

  return (
    <MoreSheetContext.Provider value={value}>
      {children}
      <MoreSheet visible={visible} onClose={() => setVisible(false)} />
    </MoreSheetContext.Provider>
  );
}

function MoreSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { employee, signOut } = useAuth();
  const isAdmin = useIsAdministrator();

  const groups = GROUPS.map(
    ([group, rows]) =>
      [group, rows.filter(([route]) => isAdmin || !ADMIN_ONLY.has(route))] as [
        string,
        [string, string, string][],
      ]
  ).filter(([, rows]) => rows.length > 0);

  function go(route: string) {
    onClose();
    router.push(`/${route}`);
  }

  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
      <View style={styles.head}>
        <ThemedText variant="h3" color={colors.goldDeep}>
          Ambika Gold Finance
        </ThemedText>
        <ThemedText variant="small" color={colors.muted}>
          {employee?.name} · {employee?.role}
        </ThemedText>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {groups.map(([group, rows]) => (
          <View key={group} style={styles.group}>
            <ThemedText variant="label" color={colors.muted} style={styles.groupLabel}>
              {group.toUpperCase()}
            </ThemedText>
            <View style={styles.island}>
              {rows.map(([route, label, icon], i) => {
                // pathname is "/loans", "/loans/12", ... — a route is active
                // when it's the first segment.
                const isActive = pathname === `/${route}` || pathname.startsWith(`/${route}/`);
                return (
                  <Pressable
                    key={route}
                    onPress={() => go(route)}
                    style={[styles.item, isActive && styles.itemActive, i > 0 && styles.itemDivider]}
                  >
                    <Icon name={icon} size={20} color={isActive ? colors.goldDeep : colors.muted} />
                    {/* Same "body" variant/font for every row, active or not —
                        only color and background change on selection. */}
                    <ThemedText variant="body" color={isActive ? colors.goldDeep : colors.ink}>
                      {label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

        <Pressable
          onPress={() => {
            onClose();
            signOut();
          }}
          style={styles.signOut}
        >
          <ThemedText variant="label" color={colors.red}>
            ← Sign out
          </ThemedText>
        </Pressable>
      </ScrollView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  head: { paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  scroll: { paddingTop: 14 },
  // Each group is its own rounded "island" card, with real gaps between
  // islands — carried over from the drawer so the sheet reads as the
  // sidebar it replaces.
  group: { marginBottom: 16 },
  groupLabel: { paddingHorizontal: 6, marginBottom: 6, letterSpacing: 0.5 },
  island: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  item: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  itemDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  itemActive: { backgroundColor: colors.goldPale },
  signOut: { paddingVertical: 14, paddingHorizontal: 6 },
});
