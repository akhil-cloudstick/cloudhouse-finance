import React from "react";
import { View, Pressable, StyleSheet, Platform } from "react-native";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ThemedText } from "@/common/components/ui/ThemedText";
import { colors } from "@/common/theme/colors";
import { Icon } from "@/common/components/ui/Icon";
import { useNotifications } from "@/common/providers/NotificationsProvider";

// Android's real blur needs an unwired blurTarget ref, so it gets a near-opaque fill instead to avoid a console warning.
const IslandSurface = Platform.OS === "ios" ? BlurView : View;

type FloatingHeaderProps = {
  title: string;
  navigation: any;
  onBellPress?: () => void;
};

export function FloatingHeader({
  title,
  navigation,
  onBellPress,
}: FloatingHeaderProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { unseenCount } = useNotifications();

  const navState = navigation?.getState?.();
  const canGoBack = navState?.type === "stack" && (navState.index ?? 0) > 0;

  function openProfile() {
    // navigate (not push) keeps the tab bar mounted and avoids stacking duplicate Profile screens.
    router.navigate("/(tabs)/more");
  }

  function pressBell() {
    onBellPress?.();
  }

  return (
    <View style={[styles.wrap, { marginTop: insets.top + 8 }]}>
      <IslandSurface
        style={[styles.island, Platform.OS === "ios" && styles.islandBlur]}
        {...(Platform.OS === "ios" ? { intensity: 80, tint: "light" as const } : {})}
      >
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
      </IslandSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, backgroundColor: "transparent" },
  island: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 253, 247, 0.92)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 8,
    overflow: "hidden",
  },
  islandBlur: { backgroundColor: "rgba(255, 253, 247, 0.7)" },
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
    backgroundColor: colors.brandDeep,
    alignItems: "center",
    justifyContent: "center",
  },
});
