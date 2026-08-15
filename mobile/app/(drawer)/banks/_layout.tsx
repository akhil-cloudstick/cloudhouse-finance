import { Stack } from "expo-router";
import { FloatingHeader } from "../../../src/components/FloatingHeader";

export default function BanksLayout() {
  return (
    <Stack
      screenOptions={{
        header: ({ options, route, navigation }) => (
          <FloatingHeader title={options.title ?? route.name} navigation={navigation} />
        ),
      }}
    >
      <Stack.Screen name="index" options={{ title: "Bank Pledge" }} />
    </Stack>
  );
}
