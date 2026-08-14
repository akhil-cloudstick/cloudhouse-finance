import { Stack } from "expo-router";
import { colors } from "../../../src/theme/colors";
import { typeScale } from "../../../src/theme/typography";

export default function EmployeesLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.ivory },
        headerTitleStyle: { fontFamily: typeScale.h3.fontFamily, color: colors.ink },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Employees" }} />
      <Stack.Screen name="new" options={{ title: "New Employee" }} />
      <Stack.Screen name="[id]" options={{ title: "Employee" }} />
    </Stack>
  );
}
