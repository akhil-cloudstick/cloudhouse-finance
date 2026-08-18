import React from "react";
import { View } from "react-native";
import { useNavigation } from "expo-router";
import { FloatingHeader } from "../../src/components/FloatingHeader";
import { ProfileContent } from "../../src/components/ProfileContent";
import { colors } from "../../src/theme/colors";

// Batch 4/5: thin wrapper around the shared ProfileContent (see
// src/components/ProfileContent.tsx) — this route owns its own
// FloatingHeader with a real back chevron (reachable via
// FloatingHeader's avatar dropdown from any tab); the More tab
// (app/(tabs)/more.tsx) renders the same ProfileContent with a tab-root
// header instead, plus a Log out button appended.
export default function ProfileScreen() {
  const navigation = useNavigation();
  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <FloatingHeader title="Profile" navigation={navigation} />
      <ProfileContent />
    </View>
  );
}
