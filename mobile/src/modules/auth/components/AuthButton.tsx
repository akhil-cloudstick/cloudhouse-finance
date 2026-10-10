import { View, Pressable, ActivityIndicator } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useTheme } from "@/common/theme/ThemeProvider";
import { ThemedText } from "@/common/components/ui/ThemedText";
import { styles } from "./authKitStyles";

// ---------------------------------------------------------------------------
// Button, messages, links

type ButtonProps = { title: string; onPress: () => void; disabled?: boolean; loading?: boolean };
// Single solid-color button.
export function AuthButton({ title, onPress, disabled, loading }: ButtonProps) {
  const { colors } = useTheme();
  const off = disabled || loading;
  return (
    <View style={[styles.buttonShadow, { shadowColor: colors.brandMid }, disabled && styles.buttonShadowOff]}>
      <Pressable
        onPress={onPress}
        disabled={off}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: colors.brand },
          disabled && { opacity: 0.45 },
          pressed && !off && { transform: [{ scale: 0.98 }] },
        ]}
      >
        {loading ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <>
            <ThemedText variant="body" color="#ffffff" style={styles.buttonLabel}>
              {title}
            </ThemedText>
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M5 12h14M13 6l6 6-6 6" />
            </Svg>
          </>
        )}
      </Pressable>
    </View>
  );
}
