import React, { useState } from "react";
import { Keyboard } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { resetPassword } from "../../src/api/auth";
import { getBusinessCode } from "../../src/auth/businessCode";
import { ApiError } from "../../src/api/client";
import {
  AuthShell,
  AuthField,
  AuthButton,
  AuthError,
  AuthLink,
  KeyboardAnchor,
  OtpInput,
  PasswordEye,
} from "../../src/components/AuthKit";

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
    Keyboard.dismiss();
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
      const code = await getBusinessCode();
      await resetPassword(phone, otp.trim(), password, code);
      router.dismissTo("/login");
    } catch (err) {
      setError(err instanceof ApiError ? err.message || "This code is invalid or has expired." : "This code is invalid or has expired.");
      setSubmitting(false);
    }
  }

  if (!phone) {
    return (
      <AuthShell eyebrow="Reset password" title={"Request a\ncode first."} onBack={() => router.replace("/login")}>
        <AuthError message="No phone number to reset — request a code first." />
        <KeyboardAnchor>
          <AuthButton title="Request a reset code" onPress={() => router.replace("/forgot-password")} />
        </KeyboardAnchor>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      compact
      eyebrow="Verify & reset"
      title={"Set a new\npassword."}
      subtitle={`Enter the 6-digit code sent to ${phone}.`}
      onBack={() => router.back()}
    >
      <OtpInput value={otp} onChange={setOtp} />
      <AuthField
        label="New password"
        icon="lock"
        placeholder="At least 8 characters"
        secureTextEntry={!showPassword}
        value={password}
        onChangeText={setPassword}
        right={<PasswordEye visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />}
      />
      <AuthField
        label="Confirm password"
        icon="lock"
        placeholder="Re-enter the password"
        secureTextEntry={!showConfirm}
        value={confirm}
        onChangeText={setConfirm}
        right={<PasswordEye visible={showConfirm} onToggle={() => setShowConfirm((v) => !v)} />}
      />

      <AuthError message={error} />

      <KeyboardAnchor>
        <AuthButton title="Set new password" onPress={handleSubmit} disabled={!otp || !password || !confirm} loading={submitting} />
      </KeyboardAnchor>
      <AuthLink label="Back to sign in" onPress={() => router.replace("/login")} />
    </AuthShell>
  );
}
