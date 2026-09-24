import { Stack } from "expo-router";
import { FloatingHeader } from "../../../src/components/FloatingHeader";
import { colors } from "../../../src/theme/colors";

// Keeps the list screen beneath a deep-linked detail route, so back/swipe
// returns to the list rather than popping the whole tab. See loans/_layout.tsx.
export const unstable_settings = { anchor: "index" };

export default function BranchesLayout() {
  return (
    <Stack
      screenOptions={{
        // Header floats over the scene; see useHeaderSpace (src/theme/layout.ts).
        headerTransparent: true,
        header: ({ options, route, navigation }) => (
          <FloatingHeader title={options.title ?? route.name} navigation={navigation} />
        ),
        // The scene's own background: without it the Stack paints white,
        // which showed through the transparent FloatingHeader as a pale band
        // across the top of every nested screen.
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Branches" }} />
      <Stack.Screen name="new" options={{ title: "New Branch" }} />
      <Stack.Screen name="[id]" options={{ title: "Branch" }} />
    </Stack>
  );
}
