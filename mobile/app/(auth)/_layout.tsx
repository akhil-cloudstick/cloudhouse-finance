import { Stack } from "expo-router";
import { colors } from "../../src/theme/colors";

export default function AuthLayout() {
  // Login/forgot-password/reset-password share one visual shell (AuthShell,
  // including its large colored BrandPanel gradient) — the default Stack
  // transition slides the whole screen in from the side like a swipe
  // between distinct pages, which reads wrong for what's really just the
  // shell's content changing. A cross-fade was tried instead, but two
  // semi-transparent copies of that same colored panel blending over each
  // other mid-transition washes out to a visible white flash at the
  // crossover point — an artifact of "fade" specifically, not of contentStyle
  // (set below regardless, since the Stack's screen container needs an
  // explicit background either way). No animation reads the cleanest here:
  // an instant swap between screens that already look like the same shell.
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
