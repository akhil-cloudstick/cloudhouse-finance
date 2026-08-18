import { Stack } from "expo-router";

// Bare stack for the Profile route — same top-level-group pattern as
// app/loan/_layout.tsx (not nested under (tabs)) so index.tsx gets a real
// navigation stack: FloatingHeader's back-chevron logic checks
// `navigation.getState().type === "stack"`, which only a genuine Stack
// screen satisfies. Reached via `router.push("/profile")` from the
// FloatingHeader avatar dropdown — not a tab, not listed under "More".
export default function ProfileLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
