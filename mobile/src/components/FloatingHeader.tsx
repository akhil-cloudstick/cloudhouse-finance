import React, { useState } from "react";
import { View, Pressable, StyleSheet, Platform, Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ThemedText } from "./ThemedText";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "./Icon";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

// Fade reaches this far below the header card; opacity steps down evenly.
const HEADER_FADE_BELOW = 48;
const HEADER_FADE_STOPS = Array.from({ length: 21 }, (_, i) => i / 20);

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
    <View style={[styles.wrap, { marginTop: insets.top + 8 }]} pointerEvents="box-none">
      {/* The header floats over the page (headerTransparent). Content scrolls
          up behind it: solid from the status-bar icons down to the header's
          bottom edge, then fading out evenly over HEADER_FADE_BELOW. */}
      <View
        pointerEvents="none"
        style={{ position: "absolute", left: 0, right: 0, top: -(insets.top + 8), height: insets.top + 8 + 48 + HEADER_FADE_BELOW }}
      >
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="headerFade" x1="0" y1="0" x2="0" y2="1">
              {(() => {
                const total = insets.top + 8 + 48 + HEADER_FADE_BELOW;
                const solidEnd = (insets.top + 8 + 48) / total;
                return [
                  <Stop key="top" offset={0} stopColor={colors.bg} stopOpacity={1} />,
                  ...HEADER_FADE_STOPS.map((s) => (
                    <Stop key={s} offset={solidEnd + s * (1 - solidEnd)} stopColor={colors.bg} stopOpacity={1 - s} />
                  )),
                ];
              })()}
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#headerFade)" />
        </Svg>
      </View>
      <IslandSurface style={styles.island}>
        {canGoBack ? (
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.iconBtn}>
            <Icon name="chevronLeft" size={22} color={colors.ink} />
          </Pressable>
        ) : (
          <View style={styles.iconBtn} />
        )}

        <ThemedText variant="label" numberOfLines={1} style={styles.title}>
          {title.toUpperCase()}
        </ThemedText>

        <Pressable onPress={() => setMenuOpen(true)} hitSlop={8} style={styles.avatar}>
          <ThemedText variant="label" color={colors.card}>
            {initials}
          </ThemedText>
        </Pressable>
      </IslandSurface>

      {/* statusBarTranslucent: the modal then lays out from the screen top like the
          header does, so insets.top isn't counted twice (the old oversized gap). */}
      <Modal visible={menuOpen} transparent statusBarTranslucent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)}>
          <View style={[styles.menu, { marginTop: insets.top + 60 }]}>
            <ThemedText variant="body" color={colors.brandDeep} style={[styles.menuName, { fontFamily: fonts.serif, fontWeight: "700" as const }]} numberOfLines={1}>
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
        shadowColor: colors.nav,
        shadowOpacity: 0.12,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 4 },
    }),
  },
  iconBtn: { width: 30, alignItems: "center", justifyContent: "center" },
  // Deliberately a small tracked-uppercase label, not an h3 — reads as nav
  // chrome rather than a content heading, so it doesn't compete with each
  // screen's own serif headings (Dashboard's "Welcome, …", a Card's h3, …).
  title: {
    flex: 1,
    textAlign: "center",
    letterSpacing: 0.6,
    fontSize: 17,
    fontFamily: fonts.serif,
    fontWeight: "700" as const,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.brandDeep,
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
        shadowColor: colors.nav,
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
