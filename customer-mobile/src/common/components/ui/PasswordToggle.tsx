import { Pressable } from "react-native";
import { colors } from "@/common/theme/colors";
import { ThemedText } from "./ThemedText";

type PasswordToggleProps = { visible: boolean; onToggle: () => void };

export function PasswordToggle({ visible, onToggle }: PasswordToggleProps) {
  return (
    <Pressable onPress={onToggle} hitSlop={10}>
      <ThemedText variant="label" color={colors.muted}>
        {visible ? "Hide" : "Show"}
      </ThemedText>
    </Pressable>
  );
}
