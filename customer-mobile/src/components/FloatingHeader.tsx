import React from "react";
import { View, Pressable, StyleSheet, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ThemedText } from "./ThemedText";
import { colors } from "../theme/colors";
import { Icon } from "./Icon";
import { useNotifications } from "../notifications/NotificationsContext";

// The avatar is a direct link to /profile — no dropdown. Log out lives on
// the Profile screen / More tab's footer (see ProfileContent's `footer`
// prop) instead of behind this menu.
export function FloatingHeader({
  title,
  navigation,
  onBellPress,
}: {
  title: string;
  navigation: any;
  onBellPress?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { unseenCount, markSeen } = useNotifications();

  const navState = navigation?.getState?.();
  const canGoBack = navState?.type === "stack" && (navState.index ?? 0) > 0;

  function openProfile() {
    router.push("/profile");
  }

  function pressBell() {
    markSeen();
    onBellPress?.();
  }

  return (
    <View style={[styles.wrap, { marginTop: insets.top + 8 }]}>
      <View style={styles.island}>
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

        {onBellPress ? (
          <Pressable onPress={pressBell} hitSlop={8} style={styles.iconBtn}>
            <Icon name="bell" size={20} color={colors.ink} />
            {unseenCount > 0 ? (
              <View style={styles.badge}>
                <ThemedText variant="label" color={colors.card} style={styles.badgeText}>
                  {unseenCount > 99 ? "99+" : unseenCount}
                </ThemedText>
              </View>
            ) : null}
          </Pressable>
        ) : null}

        <Pressable onPress={openProfile} hitSlop={8} style={styles.iconBtn}>
          <View style={styles.avatar}>
            <Icon name="user" size={16} color={colors.card} />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, backgroundColor: "transparent" },
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
      ios: { shadowColor: colors.charcoal, shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 4 },
    }),
  },
  iconBtn: { width: 30, alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute",
    top: 2,
    right: 2,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.card,
  },
  badgeText: { fontSize: 9, lineHeight: 11 },
  title: { flex: 1, textAlign: "center" },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.goldDeep,
    alignItems: "center",
    justifyContent: "center",
  },
});
