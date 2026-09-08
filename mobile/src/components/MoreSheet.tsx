import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { View, Pressable, StyleSheet, ScrollView } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { ThemedText } from "./ThemedText";
import { BottomSheetModal } from "./BottomSheetModal";
import { Icon } from "./Icon";
import { colors } from "../theme/colors";
import { useAuth } from "../auth/AuthContext";

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
// Each row now also carries the permission that gates it (module, key — the
// same underscored keys the backend derives, see src/api/permissions.ts) so
// filtering is driven by the actual permissions table instead of a single
// hardcoded admin-only set (see the house role-permission standard's §12).
// Mirrors frontend/common/components/layout/Sidebar.tsx's NAV.
type MoreItem = { route: string; label: string; icon: string; module: string; key: string };

const GROUPS: [string, MoreItem[]][] = [
  [
    "Overview",
    [
      { route: "reminders", label: "Reminders", icon: "cal", module: "Reminder_Management", key: "can_view_reminder" },
      { route: "reports", label: "Reports", icon: "chart", module: "Report_Management", key: "can_view_report" },
    ],
  ],
  [
    "Lending",
    [
      { route: "schemes", label: "Schemes", icon: "doc", module: "Scheme_Management", key: "can_view_scheme" },
      // `coin` belongs to Cash & Expenses; Gold Rates gets the balance
      // scale (rate per gram) so the two rows aren't the same glyph.
      { route: "gold-rates", label: "Gold Rates", icon: "scale", module: "Gold_Rate_Management", key: "can_view_gold_rate" },
      // Mirrors frontend/common/components/layout/Sidebar.tsx's NAV entry
      // exactly (same route name, icon, and permission).
      { route: "requests", label: "Extensions & Release", icon: "unlock", module: "Loan_Management", key: "can_view_loan" },
    ],
  ],
  [
    "Gold Custody",
    [
      { route: "packets", label: "Packets", icon: "box", module: "Packet_Management", key: "can_view_packet" },
      { route: "lockers", label: "Lockers", icon: "lock", module: "Locker_Management", key: "can_view_locker" },
      { route: "banks", label: "Bank Pledge", icon: "bank", module: "Bank_Pledge_Management", key: "can_view_bank_pledge" },
      { route: "auctions", label: "Auctions", icon: "gavel", module: "Loan_Management", key: "can_view_loan" },
    ],
  ],
  [
    "Operations",
    [
      { route: "cash", label: "Cash & Expenses", icon: "coin", module: "Cash_Management", key: "can_view_cash" },
      { route: "employees", label: "Employees", icon: "user", module: "Employee_Management", key: "can_view_employee" },
    ],
  ],
  [
    "Administration",
    [
      { route: "settings", label: "Settings", icon: "gear", module: "Settings_Management", key: "can_view_setting" },
      { route: "branches", label: "Branches", icon: "bank", module: "Branch_Management", key: "can_view_branch" },
      { route: "roles", label: "Roles & Permissions", icon: "shield", module: "Role_Management", key: "can_view_role_and_permission" },
    ],
  ],
];

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
  const { employee, signOut, can } = useAuth();

  // A permission-gated row is filtered OUT of the array (never rendered
  // disabled) — §12.3. An empty group is dropped entirely rather than
  // rendered with a bare heading — §12.4.
  const groups = GROUPS.map(
    ([group, rows]) => [group, rows.filter((item) => can(item.module, item.key))] as [string, MoreItem[]]
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
              {rows.map(({ route, label, icon }, i) => {
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
