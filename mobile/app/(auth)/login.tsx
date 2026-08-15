import React, { useState } from "react";
import { View, StyleSheet, KeyboardAvoidingView, Platform, Image, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { colors } from "../../src/theme/colors";
import { ThemedText } from "../../src/components/ThemedText";
import { GoldTextInput, PasswordToggle } from "../../src/components/GoldTextInput";
import { GoldButton } from "../../src/components/GoldButton";
import { useAuth } from "../../src/auth/AuthContext";
import { ApiError } from "../../src/api/client";

export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    try {
      await signIn(identifier.trim(), password);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
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
          <Image source={require("../../assets/splash-icon.png")} style={styles.logo} resizeMode="contain" />
          <ThemedText variant="h1" color={colors.goldDeep} style={styles.title}>
            Ambika Gold Finance
          </ThemedText>
          <ThemedText variant="body" color={colors.muted} style={styles.subtitle}>
            Staff sign in
          </ThemedText>

          <GoldTextInput
            label="Username or phone"
            autoCapitalize="none"
            value={identifier}
            onChangeText={setIdentifier}
          />
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
  logo: { width: 96, height: 96, alignSelf: "center", marginBottom: 12 },
  title: { marginBottom: 4, textAlign: "center" },
  subtitle: { marginBottom: 24, textAlign: "center" },
  error: { marginBottom: 12 },
  forgot: { marginTop: 16, alignItems: "center" },
});
