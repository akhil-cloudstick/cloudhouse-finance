import React from "react";
import { View, Alert } from "react-native";
import { FloatingHeader } from "../../src/components/FloatingHeader";
import { ProfileContent } from "../../src/components/ProfileContent";
import { GoldButton } from "../../src/components/GoldButton";
import { colors } from "../../src/theme/colors";
import { useAuth } from "../../src/auth/AuthContext";

// More tab per the Batch 5 plan: reviewing the full remaining scope (Documents
// is its own tab, real Notifications is deferred for infra reasons, and
// staff-side approval is a web-admin gap, not a customer-app page), there is
// no distinct feature left to hang off "More" — so this tab simply *is* the
// Profile view (see src/components/ProfileContent.tsx, shared with the
// pushed `/profile` route) plus a Log out button. No invented filler content
// (Support/Contact, App Version, etc.) with nothing real behind it.
export default function MoreScreen() {
  const { signOut } = useAuth();

  function confirmLogout() {
    Alert.alert("Log out?", "You'll need to verify with OTP again next time — this also clears biometric sign-in on this device.", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: () => signOut() },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <FloatingHeader title="More" navigation={undefined} />
      <ProfileContent
        footer={
          <GoldButton
            title="Log out"
            variant="outline"
            onPress={confirmLogout}
            style={{ marginTop: 8, marginBottom: 24 }}
          />
        }
      />
    </View>
  );
}
