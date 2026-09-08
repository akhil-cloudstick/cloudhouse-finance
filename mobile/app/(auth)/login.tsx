import React, { useEffect, useState } from "react";
import { View, StyleSheet, KeyboardAvoidingView, Image, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { colors } from "../../src/theme/colors";
import { ThemedText } from "../../src/components/ThemedText";
import { GoldTextInput, PasswordToggle } from "../../src/components/GoldTextInput";
import { GoldButton } from "../../src/components/GoldButton";
import { useAuth } from "../../src/auth/AuthContext";
import { ApiError } from "../../src/api/client";
import { getBusinessCode, isValidBusinessCode, normalizeBusinessCode } from "../../src/auth/businessCode";

export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The business this device last signed in to, so a returning staff member
  // does not retype it. Empty on a fresh install, which is correct: a
  // single-business backend resolves it itself. Mirrors customer-mobile's
  // "Lender code" field (src/auth/businessCode.ts).
  const [businessCode, setBusinessCode] = useState("");

  useEffect(() => {
    getBusinessCode().then(setBusinessCode);
  }, []);

  async function handleSubmit() {
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
    } finally {
      setLoading(false);
    }
  }

  return (
    // behavior "padding" on Android too (was undefined, which left the
    // inputs pinned under the keyboard): Android draws edge-to-edge here, so
    // the window is no longer auto-resized for us and the fields have to be
    // lifted manually.
    <KeyboardAvoidingView style={styles.screen} behavior="padding">
      {/* Was a plain centered View with no scroll — on shorter screens (or
          with the keyboard open) the card's bottom content, including the
          "Forgot password?" link, could render below the visible viewport
          with nothing to scroll it into view. A ScrollView with a
          flexGrow+center container keeps the centered look on tall screens
          while still allowing a scroll when content doesn't fit. */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          {/* The logo art already reads "Ambika Gold Finance", so the h1
              wordmark under it was a duplicate — dropped, and the image
              given the space it freed. */}
          <Image source={require("../../assets/ambika-gold.png")} style={styles.logo} resizeMode="contain" />
          <ThemedText variant="body" color={colors.muted} style={styles.subtitle}>
            Staff sign in
          </ThemedText>

          <GoldTextInput
            label="Username or phone"
            autoCapitalize="none"
            value={identifier}
            onChangeText={setIdentifier}
          />
          {/* The "Business code" input that used to sit here is hidden: this
            * deployment only ever has one business, and a single-business
            * backend resolves it itself without the field. The remembered
            * businessCode state/normalize-and-validate logic in
            * handleSubmit is left in place so a device that already stored
            * one (from before this field was hidden) still sends it. */}
          <GoldTextInput
            label="Password"
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={setPassword}
            right={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />}
          />

          {error ? (
            <ThemedText variant="small" color={colors.red} style={styles.error}>
              {error}
            </ThemedText>
          ) : null}

          <GoldButton
            title="Log in"
            onPress={handleSubmit}
            loading={loading}
            disabled={!identifier || !password}
          />

          <Pressable onPress={() => router.push("/forgot-password")} style={styles.forgot}>
            <ThemedText variant="label" color={colors.goldDeep}>
              Forgot password?
            </ThemedText>
          </Pressable>
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
  logo: { width: "86%", height: 200, alignSelf: "center", marginBottom: 4 },
  subtitle: { marginBottom: 24, textAlign: "center" },
  error: { marginBottom: 12 },
  forgot: { marginTop: 16, alignItems: "center" },
});
