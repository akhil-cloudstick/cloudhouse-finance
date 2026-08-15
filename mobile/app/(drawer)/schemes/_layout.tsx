import { Stack } from "expo-router";
import { FloatingHeader } from "../../../src/components/FloatingHeader";

export default function SchemesLayout() {
  return (
    <Stack
      screenOptions={{
        header: ({ options, route, navigation }) => (
          <FloatingHeader title={options.title ?? route.name} navigation={navigation} />
        ),
      }}
    >
      <Stack.Screen name="index" options={{ title: "Schemes" }} />
      <Stack.Screen name="new" options={{ title: "New Scheme" }} />
      <Stack.Screen name="[id]" options={{ title: "Scheme" }} />
    </Stack>
  );
}
