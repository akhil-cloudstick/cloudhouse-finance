import { Stack } from "expo-router";

// Bare stack for the Loan Detail route — a top-level group (not nested under
// (tabs)) so [id].tsx gets a real navigation stack: FloatingHeader's
// back-chevron logic checks `navigation.getState().type === "stack"`, which
// only a genuine Stack screen satisfies (see [id].tsx's own header). Reached
// via `router.push(\`/loan/${id}\`)` from the My Loans list — renders
// full-screen over the tab bar, same pattern as the staff app's nested-Stack
// modules avoiding double headers.
export default function LoanLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
