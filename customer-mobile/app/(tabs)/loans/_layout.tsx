import { Stack } from "expo-router";

// Nested Stack for the Loans tab, mirroring mobile/app/(tabs)/loans/_layout.tsx:
// loan detail lives INSIDE this tab's own Stack rather than a separate
// top-level group, so pushing into a loan keeps the bottom tab bar mounted
// (it belongs to the outer Tabs navigator, not this Stack) instead of it
// disappearing behind a full-screen top-level route. `anchor` puts index
// underneath a deep-linked [id] screen so back/swipe always lands on the
// loan list, not out of the tab entirely.
//
// headerShown is off here — each screen still renders its own FloatingHeader
// inline (for its own bell/notifications state), same as every other tab in
// this app. This only changes which navigator loan detail lives under.
export const unstable_settings = { anchor: "index" };

export default function LoansLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
