import React, { useState } from "react";
import { View, Pressable, StyleSheet, Platform, Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ThemedText } from "./ThemedText";
import { colors } from "../theme/colors";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "./Icon";

// Android's real blur (`blurMethod="dimezisBlurView"`) needs an explicit
// `blurTarget` ref onto a `BlurTargetView` wrapping whatever should be
// sampled — without it, expo-blur silently (and noisily, via a repeated
// console warning) falls back to no blur at all. This header sits in the
// navigator's normal document flow, not overlapping the scene beneath it,
// so there is nothing behind it TO blur on either platform — wiring up
// blurTarget here would still show nothing changing. Left as a plain
// translucent-free View until the header actually floats over scrolling
// content; see the conversation for the tradeoff.
const IslandSurface = View;

// Single, shared header for every screen in the (tabs) group — replaces
// the old default headers that stacked (navigator header + nested Stack
// header both rendering) into one floating "island" bar. Pass this as the
// `header` render prop on both the Tabs' screenOptions (for screens
// with no nested Stack) and each nested Stack's screenOptions (for
// index/detail screens inside customers/loans/etc.) — never both at once
// for the same screen, or the duplicate-header bug comes back.
export function FloatingHeader({ title, navigation }: { title: string; navigation: any }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { employee, signOut, can } = useAuth();
  const canViewSettings = can("Settings_Management", "can_view_setting");
  const [menuOpen, setMenuOpen] = useState(false);

  // Left button is a back chevron on nested Stack detail screens
  // (loans/[id], customers/new, ...); on every other screen there is no
  // left button at all — the ☰ that used to open the More sheet from here
  // was removed, since the bottom bar's own "More" slot already covers that.
  //
  // Deliberately NOT navigation.canGoBack(): the header receives whichever
  // navigator rendered it, and a tab navigator reports canGoBack() === true as
  // soon as you've switched tabs once (TabRouter keeps a history). That would
  // put a chevron on every tab except the first. Checking for a stack with
  // depth is exact.
  const navState = navigation?.getState?.();
  const canGoBack = navState?.type === "stack" && (navState.index ?? 0) > 0;

  const initials = (employee?.name ?? "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  return (
    <View style={[styles.wrap, { marginTop: insets.top + 8 }]}>
      <IslandSurface style={styles.island}>
        {canGoBack ? (
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.iconBtn}>
            <Icon name="chevronLeft" size={22} color={colors.ink} />
          </Pressable>
        ) : (
          <View style={styles.iconBtn} />
        )}

        <ThemedText variant="h3" numberOfLines={1} style={styles.title}>
          {title}
        </ThemedText>

        <Pressable onPress={() => setMenuOpen(true)} hitSlop={8} style={styles.avatar}>
          <ThemedText variant="label" color={colors.card}>
            {initials}
          </ThemedText>
        </Pressable>
      </IslandSurface>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)}>
          <View style={[styles.menu, { marginTop: insets.top + 52 }]}>
            <ThemedText variant="label" color={colors.muted} style={styles.menuName} numberOfLines={1}>
              {employee?.name}
            </ThemedText>
            {canViewSettings && (
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
