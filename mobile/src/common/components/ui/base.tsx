
import { Platform, RefreshControl, StyleSheet } from "react-native";
import { colors as C } from "@/common/theme/colors";

export { C };

/** Pull-to-refresh with the app's own loader: the native RefreshControl
 * still provides the pull gesture, but its system spinner is hidden
 * (moved off-screen on Android, transparent on iOS) — the list shows its
 * <Buffering /> while `refreshing` instead, same as any other reload. */
export function pullRefreshControl(refreshing: boolean, onRefresh: () => void) {
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor="transparent"
      colors={["transparent"]}
      progressBackgroundColor="transparent"
      progressViewOffset={Platform.OS === "android" ? -1000 : undefined}
    />
  );
}

export function initialsOf(name?: string | null) {
  return (name ?? "?")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export const styles = StyleSheet.create({
  txt: { color: C.ink, fontSize: 14.5 },
  block: { paddingVertical: 40, alignItems: "center", justifyContent: "center" },
  inline: { paddingVertical: 16, alignItems: "center", justifyContent: "center" },
  empty: { paddingVertical: 24, paddingHorizontal: 18, textAlign: "center", color: C.muted, fontSize: 12.5 },
});
