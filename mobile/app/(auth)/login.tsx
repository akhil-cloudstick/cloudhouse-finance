import React, { useEffect, useState } from "react";
import { Keyboard } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../../src/auth/AuthContext";
import { ApiError } from "../../src/api/client";
import { getBusinessCode, isValidBusinessCode, normalizeBusinessCode } from "../../src/auth/businessCode";
import {
  AuthShell,
  AuthField,
  AuthButton,
  AuthError,
  AuthLink,
  KeyboardAnchor,
  PasswordEye,
  SecureNote,
} from "../../src/components/AuthKit";

export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The business this device last signed in to. The field itself is hidden
  // (single-business deployment), but a stored code is still sent.
  const [businessCode, setBusinessCode] = useState("");

  useEffect(() => {
    getBusinessCode().then(setBusinessCode);
  }, []);

  async function handleSubmit() {
    Keyboard.dismiss();
    setError(null);
    const code = normalizeBusinessCode(businessCode);
    if (code && !isValidBusinessCode(code)) {
      setError("That business code doesn't look right — letters, numbers and dashes only.");
      return;
    }
    setLoading(true);
    try {
      await signIn(identifier.trim(), password, code);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Could not reach the server. Check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <AuthShell eyebrow="Staff portal" title={"Good to see\nyou again."} subtitle="Sign in with your username and password.">
      <AuthField
        label="Username"
        icon="user"
        placeholder="Enter your username"
        autoCapitalize="none"
        autoCorrect={false}
        value={identifier}
        onChangeText={setIdentifier}
      />
      <AuthField
        label="Password"
        icon="lock"
        placeholder="Enter your password"
        secureTextEntry={!showPassword}
        value={password}
        onChangeText={setPassword}
        right={<PasswordEye visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />}
      />

      <AuthLink label="Forgot password?" align="right" onPress={() => router.push("/forgot-password")} />

      <AuthError message={error} />

      <KeyboardAnchor>
        <AuthButton title="Sign in" onPress={handleSubmit} disabled={!identifier || !password} loading={loading} />
      </KeyboardAnchor>

      <SecureNote />
    </AuthShell>
  );
}
