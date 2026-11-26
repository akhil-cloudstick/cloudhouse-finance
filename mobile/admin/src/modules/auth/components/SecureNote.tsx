import { View } from "react-native";
import { useTheme } from "@/common/theme/ThemeProvider";
import { ThemedText } from "@/common/components/ui/ThemedText";
import { Icon } from "@/common/components/ui/Icon";
import { styles } from "./authKitStyles";

export function SecureNote() {
  const { colors } = useTheme();
  return (
    <View style={styles.secureRow}>
      <Icon name="lock" size={14} color={colors.muted} />
      <ThemedText variant="small" color={colors.muted} style={styles.secureText}>
        Encrypted &amp; secure
      </ThemedText>
    </View>
  );
}
