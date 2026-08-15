import React, { useState } from "react";
import { View, StyleSheet, KeyboardAvoidingView, Platform, Pressable, ScrollView } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { colors } from "../../src/theme/colors";
import { ThemedText } from "../../src/components/ThemedText";
import { GoldTextInput, PasswordToggle } from "../../src/components/GoldTextInput";
import { GoldButton } from "../../src/components/GoldButton";
import { resetPassword } from "../../src/api/auth";
import { ApiError } from "../../src/api/client";

// Mirrors frontend/app/reset-password/page.tsx. The phone number is fixed to
// whatever "Forgot password" requested a code for and is NOT re-typable here
// — see that file's comment: a free-text phone field here would let someone
// request a code for their own number, then swap in a different target
// phone before submitting the OTP, turning "forgot my own password" into
// "reset anyone's password given their phone number and a leaked/guessed
// code". It only ever acts on the number passed in via the route param.
export default function ResetPasswordScreen() {
  const router = useRouter();
  const { phone: phoneParam } = useLocalSearchParams<{ phone?: string }>();
  const phone = (phoneParam ?? "").trim();

  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  async function handleSubmit() {
    setError(null);
    if (!otp.trim()) {
      setError("Please enter the code sent by SMS.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword(phone, otp.trim(), password);
      router.replace("/login");
    } catch (err) {
      setError(err instanceof ApiError ? err.message || "This code is invalid or has expired." : "This code is invalid or has expired.");
      setSubmitting(false);
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
          Set a new password
        </ThemedText>

        {!phone ? (
          <>
            <ThemedText variant="body" color={colors.red} style={styles.msg}>
              No phone number to reset — request a code first.
            </ThemedText>
            <Pressable onPress={() => router.replace("/forgot-password")} style={styles.backLink}>
              <ThemedText variant="label" color={colors.muted}>
                ← Request a reset code
              </ThemedText>
            </Pressable>
          </>
        ) : (
          <>
            <ThemedText variant="small" color={colors.muted} style={styles.subtitle}>
              Resetting the password for {phone}
            </ThemedText>
            <GoldTextInput
              label="Reset code"
              keyboardType="number-pad"
              value={otp}
              onChangeText={setOtp}
            />
            <GoldTextInput
              label="New password"
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
              right={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />}
            />
            <GoldTextInput
              label="Confirm password"
              secureTextEntry={!showConfirm}
              value={confirm}
              onChangeText={setConfirm}
              right={<PasswordToggle visible={showConfirm} onToggle={() => setShowConfirm((v) => !v)} />}
            />
            {error ? (
              <ThemedText variant="small" color={colors.red} style={styles.error}>
                {error}
              </ThemedText>
            ) : null}
            <GoldButton
              title="Set new password"
              onPress={handleSubmit}
              loading={submitting}
              disabled={!otp || !password || !confirm}
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
  error: { marginBottom: 12 },
  backLink: { marginTop: 16, alignItems: "center" },
});
