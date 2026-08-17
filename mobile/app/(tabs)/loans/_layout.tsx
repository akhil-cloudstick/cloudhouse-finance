import { Stack } from "expo-router";
import { FloatingHeader } from "../../../src/components/FloatingHeader";
import { colors } from "../../../src/theme/colors";

// Pushing straight to a detail route from outside this stack (the Dashboard's
// "review" rows do `router.push('/loans/123')`) otherwise builds a stack whose
// ONLY entry is the detail screen — so back/swipe popped the whole tab and
// landed on the Dashboard instead of the loan list. `anchor` puts index
// underneath the deep-linked screen so there's always a list to go back to.
export const unstable_settings = { anchor: "index" };

export default function LoansLayout() {
  return (
    <Stack
      screenOptions={{
        header: ({ options, route, navigation }) => (
          <FloatingHeader title={options.title ?? route.name} navigation={navigation} />
        ),
        // The scene's own background: without it the Stack paints white,
        // which showed through the transparent FloatingHeader as a pale band
        // across the top of every nested screen.
        contentStyle: { backgroundColor: colors.ivory },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Loans" }} />
      <Stack.Screen name="[id]" options={{ title: "Loan" }} />
    </Stack>
  );
}
