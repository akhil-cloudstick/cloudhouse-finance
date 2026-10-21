import { Stack } from "expo-router";

// Nested Stack keeps the loan detail screen inside this tab so the outer tab bar stays mounted when pushing into it.
export const unstable_settings = { anchor: "index" };

export default function LoansLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
