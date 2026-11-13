import { Stack } from "expo-router";
import { colors } from "@/common/theme/colors";

// Screens own their headers (FlatHeader inside <Screen>, see
// src/common/components/ui/shellContext.tsx), so this stack never draws one. No anchor:
// a detail opened from another page (openPage) lands on its own, with Back
// returning to that page instead of this module's list.
export default function ModuleLayout() {
  return (
    <Stack
      screenOptions={({ route }) => ({
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        // Native slide (list -> detail) instead of the default fade; a page
        // opened straight from elsewhere (openPage marks it `direct`) just
        // appears, so the list is never seen sliding away under it.
        animation: (route.params as { direct?: string } | undefined)?.direct ? "none" : "ios_from_right",
      })}
    />
  );
}
