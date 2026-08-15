import { Stack } from "expo-router";
import { FloatingHeader } from "../../../src/components/FloatingHeader";

export default function BranchesLayout() {
  return (
    <Stack
      screenOptions={{
        header: ({ options, route, navigation }) => (
          <FloatingHeader title={options.title ?? route.name} navigation={navigation} />
        ),
      }}
    >
      <Stack.Screen name="index" options={{ title: "Branches" }} />
      <Stack.Screen name="new" options={{ title: "New Branch" }} />
      <Stack.Screen name="[id]" options={{ title: "Branch" }} />
    </Stack>
  );
}
