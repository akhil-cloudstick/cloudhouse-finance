import React, { useState } from "react";
import { Keyboard, View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "../../src/theme/ThemeProvider";
import { ThemedText } from "../../src/components/ThemedText";
import { Icon } from "../../src/components/Icon";
import { forgotPassword } from "../../src/api/auth";
import { getBusinessCode } from "../../src/auth/businessCode";
import { AuthShell, AuthField, AuthButton, AuthLink, KeyboardAnchor } from "../../src/components/AuthKit";

// Mirrors frontend/app/forgot-password/page.tsx: the backend never reveals
// whether a phone number is registered (see backend/internal/auth/handler.go's
// ForgotPassword comment), so this always shows the same generic "sent"
// message regardless of the actual result — never surface the request's
// error to the user, for the same reason the web version swallows it.
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    Keyboard.dismiss();
    setSubmitting(true);
    try {
      const code = await getBusinessCode();
      await forgotPassword(phone.trim(), code).catch(() => {});
    } finally {
      setSubmitting(false);
      setSent(true);
    }
  }

  const back = () => router.back();

  if (sent) {
    return (
      <AuthShell eyebrow="Code sent" title={"Check your\nphone."} onBack={back}>
        <View style={[styles.sentCard, { backgroundColor: colors.bg }]}>
          <View style={[styles.sentIcon, { backgroundColor: colors.greenBg }]}>
            <Icon name="check" size={22} color={colors.green} />
          </View>
          <ThemedText variant="body" color={colors.ink} style={styles.sentText}>
            If <ThemedText variant="body" color={colors.ink} style={styles.bold}>{phone.trim()}</ThemedText> is registered, a
            6-digit reset code has been sent by SMS.
          </ThemedText>
        </View>
        <KeyboardAnchor>
          <AuthButton
            title="Enter the code"
            onPress={() => router.push({ pathname: "/reset-password", params: { phone: phone.trim() } })}
          />
        </KeyboardAnchor>
        <AuthLink label="Use a different number" onPress={() => setSent(false)} />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Account recovery"
      title={"Forgot your\npassword?"}
      subtitle="Enter your registered phone number and we'll text you a reset code."
      onBack={back}
    >
      <AuthField
        label="Phone number"
        icon="phone"
        placeholder="Enter your phone number"
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
      />
      <View style={styles.spacer} />
      <KeyboardAnchor>
        <AuthButton title="Send reset code" onPress={handleSubmit} disabled={!phone.trim()} loading={submitting} />
      </KeyboardAnchor>
      <AuthLink label="Back to sign in" onPress={back} />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  spacer: { height: 8 },
  sentCard: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 18, padding: 16, marginTop: 8, marginBottom: 24 },
  sentIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  sentText: { flex: 1, fontSize: 15, lineHeight: 22 },
  bold: { fontWeight: "700" },
});
