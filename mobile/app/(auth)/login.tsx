import React, { useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Image,
  Pressable,
  ScrollView,
  TextInput,
  TextInputProps,
  StatusBar,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";
import { colors } from "../../src/theme/colors";
import { typeScale } from "../../src/theme/typography";
import { ThemedText } from "../../src/components/ThemedText";
import { Icon } from "../../src/components/Icon";
import { useAuth } from "../../src/auth/AuthContext";
import { ApiError } from "../../src/api/client";
import { getBusinessCode, isValidBusinessCode, normalizeBusinessCode } from "../../src/auth/businessCode";

const BG = colors.bg;
const FIELD_BG = colors.card;
const FIELD_BORDER = colors.line;
const TEXT = colors.ink;
const SUBTLE = colors.muted;
const ACCENT_END = "#f5a25d";

function Backdrop() {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        <RadialGradient id="glowTop" cx="30%" cy="18%" rx="75%" ry="45%">
          <Stop offset="0" stopColor={colors.brand} stopOpacity={0.14} />
          <Stop offset="1" stopColor={colors.brand} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="glowBottom" cx="85%" cy="95%" rx="60%" ry="35%">
          <Stop offset="0" stopColor={ACCENT_END} stopOpacity={0.12} />
          <Stop offset="1" stopColor={ACCENT_END} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={BG} />
      <Rect width="100%" height="100%" fill="url(#glowTop)" />
      <Rect width="100%" height="100%" fill="url(#glowBottom)" />
    </Svg>
  );
}

function Field({ label, icon, right, ...rest }: TextInputProps & { label: string; icon: string; right?: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 18 }}>
      <ThemedText variant="label" color={TEXT} style={{ marginBottom: 8 }}>
        {label}
      </ThemedText>
      <View style={styles.field}>
        <Icon name={icon} size={18} color={SUBTLE} />
        <TextInput placeholderTextColor={SUBTLE} style={styles.fieldInput} {...rest} />
        {right}
      </View>
    </View>
  );
}

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

  const disabled = !identifier || !password || loading;

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="padding">
      <StatusBar barStyle="dark-content" />
      <Backdrop />
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.logoTile}>
          <Image source={require("../../assets/cloudhouse.png")} style={styles.logo} resizeMode="contain" />
        </View>
        <ThemedText variant="h2" color={TEXT} style={styles.title}>
          Welcome back
        </ThemedText>
        <ThemedText variant="body" color={SUBTLE} style={styles.subtitle}>
          Staff sign in
        </ThemedText>

        <Field
          label="Username or phone"
          icon="user"
          placeholder="Enter your username or phone"
          autoCapitalize="none"
          value={identifier}
          onChangeText={setIdentifier}
        />
        <Field
          label="Password"
          icon="lock"
          placeholder="Enter your password"
          secureTextEntry={!showPassword}
          value={password}
          onChangeText={setPassword}
          right={
            <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={10}>
              <Icon name={showPassword ? "eye" : "eyeOff"} size={18} color={SUBTLE} />
            </Pressable>
          }
        />

        <Pressable onPress={() => router.push("/forgot-password")} style={styles.forgot} hitSlop={8}>
          <ThemedText variant="label" color={colors.brandDeep}>
            Forgot Password?
          </ThemedText>
        </Pressable>

        {error ? (
          <ThemedText variant="small" color={colors.red} style={styles.error}>
            {error}
          </ThemedText>
        ) : null}

        <Pressable onPress={handleSubmit} disabled={disabled} style={({ pressed }) => [styles.button, disabled && { opacity: 0.55 }, pressed && { opacity: 0.85 }]}>
          <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
            <Defs>
              <LinearGradient id="btn" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={colors.brandDeep} />
                <Stop offset="0.5" stopColor={colors.brandMid} />
                <Stop offset="1" stopColor={ACCENT_END} />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" rx={26} fill="url(#btn)" />
          </Svg>
          {loading ? (
            <ActivityIndicator color={colors.card} />
          ) : (
            <ThemedText variant="body" color={colors.card} style={{ fontWeight: "700" }}>
              Log In
            </ThemedText>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  scrollContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, paddingVertical: 48 },
  logoTile: {
    alignSelf: "center",
    width: 112,
    height: 112,
    borderRadius: 28,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    shadowColor: colors.brand,
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  logo: { width: 92, height: 92 },
  title: { textAlign: "center" },
  subtitle: { textAlign: "center", marginTop: 6, marginBottom: 32 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: FIELD_BORDER,
    backgroundColor: FIELD_BG,
    paddingHorizontal: 14,
  },
  fieldInput: {
    flex: 1,
    height: "100%",
    color: TEXT,
    fontFamily: typeScale.body.fontFamily,
    fontSize: typeScale.body.fontSize,
  },
  forgot: { alignSelf: "flex-end", marginTop: -4, marginBottom: 24 },
  error: { marginBottom: 12, textAlign: "center" },
  button: { height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", overflow: "hidden" },
});
