import { Stack } from "expo-router";
import { FloatingHeader } from "../../../src/components/FloatingHeader";

export default function EmployeesLayout() {
  return (
    <Stack
      screenOptions={{
        header: ({ options, route, navigation }) => (
          <FloatingHeader title={options.title ?? route.name} navigation={navigation} />
        ),
      }}
    >
      <Stack.Screen name="index" options={{ title: "Employees" }} />
      <Stack.Screen name="new" options={{ title: "New Employee" }} />
      <Stack.Screen name="[id]" options={{ title: "Employee" }} />
    </Stack>
  );
}
