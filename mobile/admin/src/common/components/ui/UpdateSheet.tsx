import { useSyncExternalStore } from "react";
import { Platform, View } from "react-native";

import { BtnRow2, C, PIcon, PrimaryButton, Sheet, Spinner, Txt, type PIconName } from "@/common/components/ui";
import {
  checkForUpdate,
  closeUpdateSheet,
  getAppUpdate,
  installApk,
  installNewBuild,
  subscribeAppUpdate,
  type AppUpdateState,
} from "@/common/utils/app-update";

type Tone = "brand" | "green" | "amber";

const TONE_BG: Record<Tone, string> = { brand: C.brandPale, green: C.greenBg, amber: C.amberBg };
const TONE_FG: Record<Tone, string> = { brand: C.brandDeep, green: C.green, amber: C.amber };

function content(s: AppUpdateState): { icon: PIconName; tone: Tone; title: string; message: string } {
  const latest = s.latestVersion ? `v${s.latestVersion}` : "A new version";
  switch (s.status) {
    case "checking":
      return { icon: "download", tone: "brand", title: "Checking for updates…", message: `You're on v${s.currentVersion}.` };
    case "install":
      return Platform.OS === "ios"
        ? { icon: "download", tone: "brand", title: "New version available", message: `${latest} is ready. Update it in TestFlight. You're on v${s.currentVersion}.` }
        : { icon: "download", tone: "brand", title: "New version available", message: `${latest} is ready to download. You're on v${s.currentVersion}.` };
    case "downloading":
      return { icon: "download", tone: "brand", title: `Downloading ${latest}`, message: "Keep the app open until the download finishes." };
    case "ready":
      return { icon: "check", tone: "green", title: "New version downloaded", message: "Tap Install, then Update when Android asks. Your data stays." };
    case "error":
      return s.error === "download"
        ? { icon: "alert", tone: "amber", title: "Couldn't download the update", message: "Check the internet connection and try again." }
        : { icon: "alert", tone: "amber", title: "Couldn't check for updates", message: "Check the internet connection and try again." };
    default:
      return { icon: "check", tone: "green", title: "You're up to date", message: `v${s.currentVersion} is the newest version.` };
  }
}

/** The new-version sheet: opens by itself when a newer build is published (app-update.ts), and from Profile → App update. */
export function UpdateSheet() {
  const s = useSyncExternalStore(subscribeAppUpdate, getAppUpdate);
  const c = content(s);

  let buttons = <PrimaryButton label="Close" variant="outline" onPress={closeUpdateSheet} />;
  if (s.status === "install") {
    buttons = (
      <>
        <PrimaryButton label="Later" variant="outline" onPress={closeUpdateSheet} />
        <PrimaryButton label={Platform.OS === "ios" ? "Open TestFlight" : "Download"} onPress={installNewBuild} />
      </>
    );
  } else if (s.status === "ready") {
    buttons = (
      <>
        <PrimaryButton label="Later" variant="outline" onPress={closeUpdateSheet} />
        <PrimaryButton label="Install" onPress={installApk} />
      </>
    );
  } else if (s.status === "error") {
    buttons = (
      <>
        <PrimaryButton label="Close" variant="outline" onPress={closeUpdateSheet} />
        <PrimaryButton label="Try again" onPress={() => (s.error === "download" ? installNewBuild() : checkForUpdate({ silent: false }))} />
      </>
    );
  } else if (s.status === "downloading") {
    buttons = <PrimaryButton label="Hide" variant="outline" onPress={closeUpdateSheet} />;
  }

  return (
    <Sheet visible={s.isSheetOpen} onClose={closeUpdateSheet} title="App update" maxHeightPct={50}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: TONE_BG[c.tone] }}>
          {s.status === "checking" ? <Spinner color={TONE_FG[c.tone]} size={20} /> : <PIcon name={c.icon} color={TONE_FG[c.tone]} />}
        </View>
        <View style={{ flex: 1 }}>
          <Txt style={{ fontWeight: "700", fontSize: 15 }}>{c.title}</Txt>
          <Txt style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{c.message}</Txt>
        </View>
      </View>
      {s.status === "downloading" ? (
        <View style={{ height: 6, borderRadius: 3, backgroundColor: C.brandPale, overflow: "hidden", marginBottom: 12 }}>
          <View style={{ height: 6, width: `${Math.round(s.progress * 100)}%`, backgroundColor: C.brandDeep }} />
        </View>
      ) : null}
      <BtnRow2>{buttons}</BtnRow2>
    </Sheet>
  );
}
