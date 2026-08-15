import React, { useState } from "react";
import { View, Pressable, StyleSheet, Platform, Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ThemedText } from "./ThemedText";
import { colors } from "../theme/colors";
import { useAuth, useIsAdministrator } from "../auth/AuthContext";

// Single, shared header for every screen in the (drawer) group — replaces
// the old default headers that stacked (Drawer header + nested Stack
// header both rendering) into one floating "island" bar. Pass this as the
// `header` render prop on both the Drawer's screenOptions (for screens
// with no nested Stack) and each nested Stack's screenOptions (for
// index/detail screens inside customers/loans/etc.) — never both at once
// for the same screen, or the duplicate-header bug comes back.
export function FloatingHeader({ title, navigation }: { title: string; navigation: any }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { employee, signOut } = useAuth();
  const isAdmin = useIsAdministrator();
  const [menuOpen, setMenuOpen] = useState(false);

  // Always opens the drawer — deliberately never a back-chevron. The
  // sidebar is the one way to move between pages, so every screen (however
  // deep) keeps the same ☰ affordance rather than swapping to "back to
  // wherever I came from".
  function handleMenuPress() {
    if (typeof navigation?.openDrawer === "function") {
      // Screens with no nested Stack (dashboard, gold-rates, ...) get the
      // Drawer's own navigation object directly.
      navigation.openDrawer();
    } else {
      // Nested Stack screens (customers, loans, ...) get the Stack's
      // navigation — walk up to the parent Drawer navigator to open it.
      const parent = navigation?.getParent?.();
      if (typeof parent?.openDrawer === "function") parent.openDrawer();
    }
  }

  const initials = (employee?.name ?? "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  return (
    <View style={[styles.wrap, { marginTop: insets.top + 8 }]}>
      <View style={styles.island}>
        <Pressable onPress={handleMenuPress} hitSlop={10} style={styles.iconBtn}>
          <ThemedText variant="h3" color={colors.ink}>
            ☰
          </ThemedText>
        </Pressable>

        <ThemedText variant="h3" numberOfLines={1} style={styles.title}>
          {title}
        </ThemedText>

        <Pressable onPress={() => setMenuOpen(true)} hitSlop={8} style={styles.avatar}>
          <ThemedText variant="label" color={colors.card}>
            {initials}
          </ThemedText>
        </Pressable>
      </View>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)}>
          <View style={[styles.menu, { marginTop: insets.top + 64 }]}>
            <ThemedText variant="label" color={colors.muted} style={styles.menuName} numberOfLines={1}>
              {employee?.name}
            </ThemedText>
            {isAdmin && (
              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  router.push("/settings");
                }}
                style={styles.menuItem}
              >
                <ThemedText variant="body">Settings</ThemedText>
              </Pressable>
            )}
            <Pressable
              onPress={() => {
                setMenuOpen(false);
                signOut();
              }}
              style={styles.menuItem}
            >
              <ThemedText variant="body" color={colors.red}>
                Log out
              </ThemedText>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 12,
    backgroundColor: "transparent",
  },
  island: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 8,
    ...Platform.select({
      ios: {
        shadowColor: colors.charcoal,
        shadowOpacity: 0.12,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 4 },
    }),
  },
  iconBtn: { width: 30, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center" },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.goldDeep,
    alignItems: "center",
    justifyContent: "center",
  },
  backdrop: { flex: 1, alignItems: "flex-end" },
  menu: {
    marginRight: 16,
    minWidth: 160,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 6,
    ...Platform.select({
      ios: {
        shadowColor: colors.charcoal,
        shadowOpacity: 0.15,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 6 },
    }),
  },
  menuName: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  menuItem: { paddingHorizontal: 14, paddingVertical: 10 },
});
