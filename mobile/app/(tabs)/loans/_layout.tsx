import { Stack, usePathname, useRouter } from "expo-router";
import { View } from "react-native";
import { FloatingHeader } from "../../../src/components/FloatingHeader";
import { colors } from "../../../src/theme/colors";

// Pushing straight to a detail route from outside this stack (the Dashboard's
// "review" rows do `router.push('/loans/123')`) otherwise builds a stack whose
// ONLY entry is the detail screen — so back/swipe popped the whole tab and
// landed on the Dashboard instead of the loan list. `anchor` puts index
// underneath the deep-linked screen so there's always a list to go back to.
export const unstable_settings = { anchor: "index" };

export default function LoansLayout() {
  // FloatingHeader used to be rendered via the Stack's `header` render prop,
  // which meant a fresh instance per Stack.Screen — native-stack renders a
  // custom header as part of that screen's own animated card, so switching
  // index -> [id] visually pushed the WHOLE header along with the content
  // instead of leaving it in place with just its title changing. Hoisting
  // one persistent FloatingHeader above a header-less Stack fixes that: this
  // instance never remounts on navigation within the module, only its
  // `title` prop re-renders as the route changes.
  const pathname = usePathname();
  const router = useRouter();
  // This stack only has two screens ("index" and "[id]") — anywhere other
  // than the list route means the detail screen is on top.
  const onDetail = pathname !== "/loans";

  return (
    <View style={{ flex: 1, backgroundColor: "orange" }}>
      <FloatingHeader
        title={onDetail ? "Loan" : "Loans"}
        // FloatingHeader only reads goBack()/getState() off `navigation` (for
        // the back chevron and its canGoBack check) — this is no longer
        // sitting inside the Stack's header slot, so there's no React
        // Navigation `navigation` object handed to us the way the render
        // prop used to; this shim covers exactly those two members.
        navigation={{ goBack: () => router.back(), getState: () => ({ type: "stack", index: onDetail ? 1 : 0 }) }}
      />
      <Stack
        screenOptions={{
          headerShown: false,
          // The scene's own background: without it the Stack paints white,
          // which showed through the transparent FloatingHeader as a pale
          // band across the top of every nested screen.
          contentStyle: { backgroundColor: "orange" },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Loans" }} />
        <Stack.Screen name="[id]" options={{ title: "Loan" }} />
      </Stack>
    </View>
  );
}
