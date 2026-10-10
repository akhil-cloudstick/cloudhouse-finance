import { useRef, useState } from "react";
import { View, Pressable, TextInput } from "react-native";
import { useTheme } from "@/common/theme/ThemeProvider";
import { ThemedText } from "@/common/components/ui/ThemedText";
import { doneBarFor } from "@/common/components/ui/KeyboardDoneBar";
import { styles } from "./authKitStyles";

type OtpInputProps = { value: string; onChange: (v: string) => void; length?: number };

// Six separate digit boxes over one hidden TextInput, so paste and SMS
// autofill still arrive in a single onChangeText.
export function OtpInput({ value, onChange, length = 6 }: OtpInputProps) {
  const { colors } = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const active = Math.min(value.length, length - 1);

  return (
    <View style={styles.fieldGroup}>
      <ThemedText variant="label" color={colors.ink} style={styles.fieldLabel}>
        Verification code
      </ThemedText>
      <Pressable onPress={() => inputRef.current?.focus()} style={styles.otpRow}>
        {Array.from({ length }).map((_, i) => {
          const isActive = focused && i === active;
          const filled = i < value.length;
          return (
            <View
              key={i}
              style={[
                styles.otpBox,
                isActive
                  ? { borderColor: colors.brand, backgroundColor: colors.card }
                  : { borderColor: filled ? colors.brandPale : "transparent", backgroundColor: filled ? colors.brandFaint : colors.bg },
              ]}
            >
              <ThemedText variant="h3" color={colors.ink}>
                {value[i] ?? ""}
              </ThemedText>
            </View>
          );
        })}
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={(t) => onChange(t.replace(/\D/g, "").slice(0, length))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="number-pad"
          inputAccessoryViewID={doneBarFor("number-pad")}
          textContentType="oneTimeCode"
          maxLength={length}
          caretHidden
          importantForAutofill="no"
          style={styles.otpHidden}
        />
      </Pressable>
    </View>
  );
}
