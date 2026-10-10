import React from "react";
import { View, Alert } from "react-native";
import { FloatingHeader } from "@/common/components/layout/FloatingHeader";
import { ProfileContent } from "@/modules/profile/components/ProfileContent";
import { GoldButton } from "@/common/components/ui/GoldButton";
import { colors } from "@/common/theme/colors";
import { useAuth } from "@/common/providers/AuthProvider";

// Profile tab per the Batch 5 plan: reviewing the full remaining scope
// (Documents is its own tab, real Notifications is deferred for infra
// reasons, and staff-side approval is a web-admin gap, not a customer-app
// page), there is no distinct feature left to hang off a catch-all "More" —
// so this tab simply *is* the Profile view (see
// src/modules/profile/components/ProfileContent.tsx — FloatingHeader's avatar button
// everywhere else navigates straight here) plus a Log out button. No
// invented filler content (Support/
// Contact, App Version, etc.) with nothing real behind it. Route file stays
// named `more` — renaming it would also mean touching AppTabBar.tsx's route
// keys and _layout.tsx's Screen name for no functional gain; only the
// user-visible label/title changed.
export default function MoreScreen() {
  const { signOut } = useAuth();

  function confirmLogout() {
    Alert.alert("Log out?", "You'll need to verify with OTP again next time — this also clears biometric sign-in on this device.", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: () => signOut() },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FloatingHeader title="Profile" navigation={undefined} />
      {/* Sign out used to only live at the very bottom of ProfileContent's
       * scroll, past Identity/Nominee/KYC — reaching it meant scrolling
       * through the whole profile every time. Pinned right under the
       * header instead, so it's one tap away regardless of scroll
       * position. */}
      <View style={{ paddingHorizontal: 16, marginTop: 4, marginBottom: 4 }}>
        <GoldButton title="Log out" variant="outline" onPress={confirmLogout} />
      </View>
      <ProfileContent />
    </View>
  );
}
