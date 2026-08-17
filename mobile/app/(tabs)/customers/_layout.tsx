import { Stack } from "expo-router";
import { FloatingHeader } from "../../../src/components/FloatingHeader";
import { colors } from "../../../src/theme/colors";

// Keeps the list screen beneath a deep-linked detail route, so back/swipe
// returns to the list rather than popping the whole tab. See loans/_layout.tsx.
export const unstable_settings = { anchor: "index" };

export default function CustomersLayout() {
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
      <Stack.Screen name="index" options={{ title: "Customers" }} />
      <Stack.Screen name="new" options={{ title: "Register Customer" }} />
      <Stack.Screen name="[id]" options={{ title: "Customer" }} />
    </Stack>
  );
}
