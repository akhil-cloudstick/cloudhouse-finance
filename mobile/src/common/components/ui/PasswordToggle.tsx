import { Pressable } from "react-native";
import { colors } from "@/common/theme/colors";
import { ThemedText } from "./ThemedText";

type PasswordToggleProps = { visible: boolean; onToggle: () => void };

// Convenience eye toggle for password fields — <GoldTextInput secureTextEntry
// right={<PasswordToggle visible={show} onToggle={() => setShow(v => !v)} />} .../>
export function PasswordToggle({ visible, onToggle }: PasswordToggleProps) {
  return (
    <Pressable onPress={onToggle} hitSlop={10}>
      <ThemedText variant="label" color={colors.muted}>
        {visible ? "Hide" : "Show"}
      </ThemedText>
    </Pressable>
  );
}
