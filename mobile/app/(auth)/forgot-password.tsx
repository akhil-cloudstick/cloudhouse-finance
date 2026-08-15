import React, { useState } from "react";
import { View, StyleSheet, KeyboardAvoidingView, Platform, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { colors } from "../../src/theme/colors";
import { ThemedText } from "../../src/components/ThemedText";
import { GoldTextInput } from "../../src/components/GoldTextInput";
import { GoldButton } from "../../src/components/GoldButton";
import { forgotPassword } from "../../src/api/auth";

// Mirrors frontend/app/forgot-password/page.tsx: the backend never reveals
// whether a phone number is registered (see backend/internal/auth/handler.go's
// ForgotPassword comment), so this always shows the same generic "sent"
// message regardless of the actual result — never surface the request's
// error to the user, for the same reason the web version swallows it.
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await forgotPassword(phone.trim()).catch(() => {});
    } finally {
      setSubmitting(false);
      setSent(true);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
      <View style={styles.card}>
        <ThemedText variant="h2" color={colors.goldDeep} style={styles.title}>
          Reset your password
        </ThemedText>

        {sent ? (
          <>
            <ThemedText variant="body" style={styles.msg}>
              If that phone number is registered, a reset code has been sent by SMS.
            </ThemedText>
            <GoldButton
              title="Enter the code →"
              onPress={() => router.push({ pathname: "/reset-password", params: { phone: phone.trim() } })}
            />
            <Pressable onPress={() => router.replace("/login")} style={styles.backLink}>
              <ThemedText variant="label" color={colors.muted}>
                ← Back to login
              </ThemedText>
            </Pressable>
          </>
        ) : (
          <>
            <ThemedText variant="small" color={colors.muted} style={styles.subtitle}>
              Enter your registered phone number and we&apos;ll text you a reset code.
            </ThemedText>
            <GoldTextInput
              label="Phone number"
              keyboardType="phone-pad"
              autoComplete="tel"
              value={phone}
              onChangeText={setPhone}
            />
            <GoldButton
              title="Send reset code"
              onPress={handleSubmit}
              loading={submitting}
              disabled={!phone.trim()}
            />
            <Pressable onPress={() => router.replace("/login")} style={styles.backLink}>
              <ThemedText variant="label" color={colors.muted}>
                ← Back to login
              </ThemedText>
            </Pressable>
          </>
        )}
      </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ivory },
  scrollContent: { flexGrow: 1, justifyContent: "center", padding: 24 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 24,
  },
  title: { marginBottom: 8, textAlign: "center" },
  subtitle: { marginBottom: 20, textAlign: "center" },
  msg: { marginBottom: 20, textAlign: "center" },
  backLink: { marginTop: 16, alignItems: "center" },
});
