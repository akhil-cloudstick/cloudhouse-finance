import { Stack } from "expo-router";
import { colors } from "../../../src/theme/colors";
import { typeScale } from "../../../src/theme/typography";

export default function AuctionsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.ivory },
        headerTitleStyle: { fontFamily: typeScale.h3.fontFamily, color: colors.ink },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Auctions" }} />
    </Stack>
  );
}
