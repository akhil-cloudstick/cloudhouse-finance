import React, { useState } from "react";
import { View, StyleSheet, KeyboardAvoidingView, Platform, Image } from "react-native";
import { colors } from "../../src/theme/colors";
import { ThemedText } from "../../src/components/ThemedText";
import { GoldTextInput } from "../../src/components/GoldTextInput";
import { GoldButton } from "../../src/components/GoldButton";
import { useAuth } from "../../src/auth/AuthContext";
import { ApiError } from "../../src/api/client";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
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
      <View style={styles.card}>
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
          secureTextEntry
          value={password}
          onChangeText={setPassword}
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
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ivory,
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 24,
  },
  title: { marginBottom: 4, textAlign: "center" },
  subtitle: { marginBottom: 24, textAlign: "center" },
  error: { marginBottom: 12 },
});
