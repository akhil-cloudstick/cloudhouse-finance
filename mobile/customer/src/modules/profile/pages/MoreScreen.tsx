import React, { useSyncExternalStore } from "react";
import { View, Alert } from "react-native";
import { getAppUpdate, openUpdateSheet, subscribeAppUpdate } from "@/common/utils/app-update";
import { FloatingHeader } from "@/common/components/layout/FloatingHeader";
import { ProfileContent } from "@/modules/profile/components/ProfileContent";
import { GoldButton } from "@/common/components/ui/GoldButton";
import { colors } from "@/common/theme/colors";
import { useAuth } from "@/common/providers/AuthProvider";

// This tab is the Profile view plus a Log out button; route file stays named `more` to avoid touching route keys.
export default function MoreScreen() {
  const { signOut } = useAuth();
  const update = useSyncExternalStore(subscribeAppUpdate, getAppUpdate);

  function confirmLogout() {
    Alert.alert("Log out?", "You'll need to verify with OTP again next time — this also clears biometric sign-in on this device.", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: () => signOut() },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FloatingHeader title="Profile" navigation={undefined} />
      {/* Pinned under the header instead of at the bottom of the scroll, so it's one tap away. */}
      <View style={{ paddingHorizontal: 16, marginTop: 4, marginBottom: 4, gap: 10 }}>
        <GoldButton title={update.status === "install" && update.latestVersion ? `Update to v${update.latestVersion}` : `App update (v${update.currentVersion})`} variant="outline" onPress={openUpdateSheet} />
        <GoldButton title="Log out" variant="outline" onPress={confirmLogout} />
      </View>
      <ProfileContent />
    </View>
  );
}
