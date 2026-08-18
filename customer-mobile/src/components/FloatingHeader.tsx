import React, { useState } from "react";
import { View, Pressable, StyleSheet, Platform, Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ThemedText } from "./ThemedText";
import { colors } from "../theme/colors";
import { Icon } from "./Icon";
import { useAuth } from "../auth/AuthContext";
import { useNotifications } from "../notifications/NotificationsContext";

// Batch 4: the avatar is now a real pressable that opens a dropdown
// (Profile / Log out), mirroring mobile/src/components/FloatingHeader.tsx's
// Modal (transparent/fade) menu pattern, simplified — no Settings/admin
// item since there's no such concept in the customer app. The bell (when
// `onBellPress` is given) and the avatar now render together instead of the
// old either/or ternary, since Log out moved into the dropdown and no
// longer needs its own icon slot (the Batch 3 `onLogoutPress` prop is
// removed — see app/(tabs)/index.tsx).
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
  const { customer, signOut } = useAuth();
  const { unseenCount, markSeen } = useNotifications();
  const [menuOpen, setMenuOpen] = useState(false);

  const navState = navigation?.getState?.();
  const canGoBack = navState?.type === "stack" && (navState.index ?? 0) > 0;

  function openProfile() {
    setMenuOpen(false);
    router.push("/profile");
  }

  function logout() {
    setMenuOpen(false);
    signOut();
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

        <Pressable onPress={() => setMenuOpen(true)} hitSlop={8} style={styles.iconBtn}>
          <View style={styles.avatar}>
            <Icon name="user" size={16} color={colors.card} />
          </View>
        </Pressable>
      </View>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)}>
          <View style={[styles.menu, { marginTop: insets.top + 56 }]}>
            {customer?.name ? (
              <>
                <ThemedText variant="label" numberOfLines={1} style={styles.menuName}>
                  {customer.name}
                </ThemedText>
                <View style={styles.menuDivider} />
              </>
            ) : null}
            <Pressable onPress={openProfile} style={styles.menuItem}>
              <Icon name="user" size={16} color={colors.ink} />
              <ThemedText variant="body" style={{ marginLeft: 10 }}>
                Profile
              </ThemedText>
            </Pressable>
            <View style={styles.menuDivider} />
            <Pressable onPress={logout} style={styles.menuItem}>
              <Icon name="logout" size={16} color={colors.red} />
              <ThemedText variant="body" color={colors.red} style={{ marginLeft: 10 }}>
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
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.15)", alignItems: "flex-end" },
  menu: {
    marginRight: 12,
    minWidth: 180,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 6,
    ...Platform.select({
      ios: { shadowColor: colors.charcoal, shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
      android: { elevation: 6 },
    }),
  },
  menuName: { paddingHorizontal: 14, paddingVertical: 8 },
  menuDivider: { height: 1, backgroundColor: colors.line },
  menuItem: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12 },
});
