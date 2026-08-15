import { Stack } from "expo-router";
import { FloatingHeader } from "../../../src/components/FloatingHeader";

export default function CashLayout() {
  return (
    <Stack
      screenOptions={{
        header: ({ options, route, navigation }) => (
          <FloatingHeader title={options.title ?? route.name} navigation={navigation} />
        ),
      }}
    >
      <Stack.Screen name="index" options={{ title: "Cash & Expenses" }} />
      <Stack.Screen name="movements" options={{ title: "Cash Movements" }} />
      <Stack.Screen name="expenses" options={{ title: "Expenses" }} />
    </Stack>
  );
}
