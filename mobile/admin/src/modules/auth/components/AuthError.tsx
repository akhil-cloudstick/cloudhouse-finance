import { View } from "react-native";
import { useTheme } from "@/common/theme/ThemeProvider";
import { ThemedText } from "@/common/components/ui/ThemedText";
import { Icon } from "@/common/components/ui/Icon";
import { styles } from "./authKitStyles";

type AuthErrorProps = { message: string | null };

export function AuthError({ message }: AuthErrorProps) {
  const { colors } = useTheme();
  if (!message) return null;
  return (
    <View style={[styles.errorBox, { backgroundColor: colors.redBg }]}>
      <Icon name="warning" size={18} color={colors.red} />
      <ThemedText variant="body" color={colors.red} style={styles.errorText}>
        {message}
      </ThemedText>
    </View>
  );
}
