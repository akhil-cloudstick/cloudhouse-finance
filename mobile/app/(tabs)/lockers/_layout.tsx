import { Stack } from "expo-router";
import { colors } from "../../../src/theme/colors";

// Screens own their headers (FlatHeader inside <Screen>, see
// src/components/ui/Shell.tsx), so this stack never draws one. `anchor`
// keeps the list underneath a deep-linked detail screen so back always
// lands on the list rather than popping the whole tab.
export const unstable_settings = { anchor: "index" };

export default function ModuleLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}
