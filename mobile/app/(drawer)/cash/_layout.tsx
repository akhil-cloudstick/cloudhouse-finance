import { Stack } from "expo-router";
import { colors } from "../../../src/theme/colors";
import { typeScale } from "../../../src/theme/typography";

export default function CashLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.ivory },
        headerTitleStyle: { fontFamily: typeScale.h3.fontFamily, color: colors.ink },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Cash & Expenses" }} />
      <Stack.Screen name="movements" options={{ title: "Cash Movements" }} />
      <Stack.Screen name="expenses" options={{ title: "Expenses" }} />
    </Stack>
  );
}
