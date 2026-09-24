import { Stack } from "expo-router";
import { FloatingHeader } from "../../../src/components/FloatingHeader";
import { colors } from "../../../src/theme/colors";

// Same "anchor: index" reasoning as personal-loans/_layout.tsx: a deep link
// straight to an investment's detail screen must still leave a list
// underneath it to swipe/back into.
export const unstable_settings = { anchor: "index" };

export default function InvestmentsLayout() {
  return (
    <Stack
      screenOptions={{
        // Header floats over the scene; see useHeaderSpace (src/theme/layout.ts).
        headerTransparent: true,
        header: ({ options, route, navigation }) => (
          <FloatingHeader title={options.title ?? route.name} navigation={navigation} />
        ),
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Investments" }} />
      <Stack.Screen name="new" options={{ title: "New Investment" }} />
      <Stack.Screen name="plans" options={{ title: "Manage Plans" }} />
      <Stack.Screen name="[id]" options={{ title: "Investment" }} />
    </Stack>
  );
}
