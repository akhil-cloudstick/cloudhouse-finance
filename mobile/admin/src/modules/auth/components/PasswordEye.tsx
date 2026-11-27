import { Pressable } from "react-native";
import { useTheme } from "@/common/theme/ThemeProvider";
import { Icon } from "@/common/components/ui/Icon";
import { styles } from "./authKitStyles";

type PasswordEyeProps = { visible: boolean; onToggle: () => void };

export function PasswordEye({ visible, onToggle }: PasswordEyeProps) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onToggle} hitSlop={12} style={styles.eye}>
      <Icon name={visible ? "eye" : "eyeOff"} size={20} color={colors.muted} />
    </Pressable>
  );
}
