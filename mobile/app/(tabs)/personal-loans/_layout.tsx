import { Stack } from "expo-router";
import { FloatingHeader } from "../../../src/components/FloatingHeader";
import { colors } from "../../../src/theme/colors";

// Same "anchor: index" reasoning as loans/_layout.tsx: a deep link straight
// to a personal loan's detail screen (e.g. from a Customer 360 tab) must
// still leave a list underneath it to swipe/back into.
export const unstable_settings = { anchor: "index" };

export default function PersonalLoansLayout() {
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
      <Stack.Screen name="index" options={{ title: "Personal Loans" }} />
      <Stack.Screen name="new" options={{ title: "New Personal Loan" }} />
      <Stack.Screen name="[id]" options={{ title: "Personal Loan" }} />
    </Stack>
  );
}
