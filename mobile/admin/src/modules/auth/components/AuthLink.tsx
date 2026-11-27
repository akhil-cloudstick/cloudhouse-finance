import { Pressable } from "react-native";
import { useTheme } from "@/common/theme/ThemeProvider";
import { ThemedText } from "@/common/components/ui/ThemedText";
import { styles } from "./authKitStyles";

type AuthLinkProps = { label: string; onPress: () => void; align?: "center" | "right" };

export function AuthLink({ label, onPress, align = "center" }: AuthLinkProps) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={8} style={align === "right" ? styles.linkRight : styles.linkCenter}>
      <ThemedText variant="label" color={align === "right" ? colors.brand : colors.muted} style={styles.linkText}>
        {label}
      </ThemedText>
    </Pressable>
  );
}
