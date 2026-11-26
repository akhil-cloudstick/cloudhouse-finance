import { Stack } from "expo-router";
import { colors } from "@/common/theme/colors";

export default function AuthLayout() {
  // Login now carries Forgot/Reset password as internal phases (see its own
  // comment) rather than as separate routes, so this stack in practice only
  // ever shows one real screen — forgot-password.app/(auth)/reset-password.tsx are
  // just redirects, kept for old links. `animation: "none"` and an explicit
  // background are still worth keeping for that redirect bounce itself.
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "none",
        contentStyle: { backgroundColor: colors.card },
      }}
    />
  );
}
