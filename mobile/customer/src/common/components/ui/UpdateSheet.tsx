import { useSyncExternalStore } from "react";
import { ActivityIndicator, Platform, View } from "react-native";

import { BottomSheetModal } from "@/common/components/ui/BottomSheetModal";
import { GoldButton } from "@/common/components/ui/GoldButton";
import { ThemedText } from "@/common/components/ui/ThemedText";
import { colors } from "@/common/theme/colors";
import {
  checkForUpdate,
  closeUpdateSheet,
  getAppUpdate,
  installApk,
  installNewBuild,
  subscribeAppUpdate,
  type AppUpdateState,
} from "@/common/utils/app-update";

function content(s: AppUpdateState): { title: string; message: string; color: string } {
  const latest = s.latestVersion ? `v${s.latestVersion}` : "A new version";
  switch (s.status) {
    case "checking":
      return { title: "Checking for updates…", message: `You're on v${s.currentVersion}.`, color: colors.muted };
    case "install":
      return Platform.OS === "ios"
        ? { title: "New version available", message: `${latest} is ready. Update it in TestFlight. You're on v${s.currentVersion}.`, color: colors.muted }
        : { title: "New version available", message: `${latest} is ready to download. You're on v${s.currentVersion}.`, color: colors.muted };
    case "downloading":
      return { title: `Downloading ${latest}`, message: "Keep the app open until the download finishes.", color: colors.muted };
    case "ready":
      return { title: "New version downloaded", message: "Tap Install, then Update when Android asks. Your data stays.", color: colors.green };
    case "error":
      return s.error === "download"
        ? { title: "Couldn't download the update", message: "Check the internet connection and try again.", color: colors.red }
        : { title: "Couldn't check for updates", message: "Check the internet connection and try again.", color: colors.red };
    default:
      return { title: "You're up to date", message: `v${s.currentVersion} is the newest version.`, color: colors.green };
  }
}

// The new-version sheet: opens by itself when a newer build is published (app-update.ts), and from Profile → App update.
export function UpdateSheet() {
  const s = useSyncExternalStore(subscribeAppUpdate, getAppUpdate);
  const c = content(s);

  let primary: { title: string; onPress: () => void } | null = null;
  if (s.status === "install") primary = { title: Platform.OS === "ios" ? "Open TestFlight" : "Download", onPress: installNewBuild };
  else if (s.status === "ready") primary = { title: "Install", onPress: installApk };
  else if (s.status === "error") primary = { title: "Try again", onPress: () => (s.error === "download" ? installNewBuild() : checkForUpdate({ silent: false })) };
  const dismissLabel = s.status === "downloading" ? "Hide" : primary ? "Later" : "Close";

  return (
    <BottomSheetModal visible={s.isSheetOpen} onClose={closeUpdateSheet} maxHeightPct={50}>
      <ThemedText variant="h3" style={{ marginBottom: 8 }}>
        {c.title}
      </ThemedText>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 }}>
        {s.status === "checking" ? <ActivityIndicator color={colors.brand} /> : null}
        <ThemedText variant="small" color={c.color} style={{ flex: 1 }}>
          {c.message}
        </ThemedText>
      </View>
      {s.status === "downloading" ? (
        <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.brandPale, overflow: "hidden", marginBottom: 16 }}>
          <View style={{ height: 6, width: `${Math.round(s.progress * 100)}%`, backgroundColor: colors.brand }} />
        </View>
      ) : null}
      <View style={{ gap: 10 }}>
        {primary ? <GoldButton title={primary.title} onPress={primary.onPress} /> : null}
        <GoldButton title={dismissLabel} variant="outline" onPress={closeUpdateSheet} />
      </View>
    </BottomSheetModal>
  );
}
