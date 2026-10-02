import { Stack } from "expo-router";
import { colors } from "../../../src/theme/colors";

// Same module stack as settings/_layout.tsx: screens own their headers, and a
// page opened from the More sheet (openPage marks it `direct`) just appears.
export default function ModuleLayout() {
  return (
    <Stack
      screenOptions={({ route }) => ({
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: (route.params as { direct?: string } | undefined)?.direct ? "none" : "ios_from_right",
      })}
    />
  );
}
