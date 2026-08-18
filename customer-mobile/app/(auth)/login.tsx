import React, { useEffect, useState } from "react";
import { View, StyleSheet, KeyboardAvoidingView, Image, ScrollView } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { colors } from "../../src/theme/colors";
import { ThemedText } from "../../src/components/ThemedText";
import { GoldTextInput } from "../../src/components/GoldTextInput";
import { GoldButton } from "../../src/components/GoldButton";
import { useAuth } from "../../src/auth/AuthContext";
import { ApiError } from "../../src/api/client";
import * as authApi from "../../src/api/auth";
import { saveDeviceToken, getOrCreateDeviceId, getDeviceToken, clearDeviceToken } from "../../src/auth/deviceToken";

type Step = "phone" | "otp";

// Two-step phone -> OTP flow (WhatsApp-delivered code), per the plan. On a
// successful verify, the app immediately tries to register this device for
// biometric sign-in next time — that's mandatory in the sense that it
// always attempts it, but a device with no usable biometric
// hardware/enrollment simply can't complete registration; the user still
// ends up signed in via the session token either way, and every later cold
// start on that device just falls back to OTP (see app/_layout.tsx).
export default function LoginScreen() {
  const { completeLogin } = useAuth();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [biometricNotice, setBiometricNotice] = useState<string | null>(null);

  // A device token surviving until this screen shows means either the app's
  // cold-start biometric attempt (app/_layout.tsx's bootstrapSession) was
  // cancelled/failed rather than server-rejected (that path leaves the
  // token intact on purpose), or the customer navigated here some other
  // way with one still stored. Either way, offer a retry without forcing
  // a full OTP re-verification.
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [hasDeviceToken, setHasDeviceToken] = useState(false);

  useEffect(() => {
    getDeviceToken().then((t) => setHasDeviceToken(!!t));
  }, []);

  async function handleBiometricLogin() {
    setError(null);
    setBiometricLoading(true);
    try {
      const deviceToken = await getDeviceToken();
      if (!deviceToken) {
        setHasDeviceToken(false);
        return;
      }
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = hasHardware && (await LocalAuthentication.isEnrolledAsync());
      if (!isEnrolled) {
        setError("Biometric unlock isn't set up on this device right now.");
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Sign in to Ambika Gold Finance",
      });
      if (!result.success) return; // cancelled — token stays valid, stay on this screen
      try {
        const session = await authApi.deviceLogin(deviceToken);
        await completeLogin(session);
      } catch (err) {
        // The server rejected this token (revoked/expired) — it's
        // genuinely dead now, so clear it and drop back to plain OTP.
        await clearDeviceToken();
        setHasDeviceToken(false);
        setError(err instanceof ApiError ? err.message : "Biometric sign-in is no longer available on this device — please sign in with an OTP.");
      }
    } finally {
      setBiometricLoading(false);
    }
  }

  async function handleRequestOtp() {
    setError(null);
    setLoading(true);
    try {
      await authApi.requestOtp(phone.trim());
      setStep("otp");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function enrollDeviceBiometric() {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = hasHardware && (await LocalAuthentication.isEnrolledAsync());
      if (!hasHardware || !isEnrolled) {
        // No usable biometric hardware/enrollment — device registration is
        // skipped. This is the documented fallback path, not a dead end:
        // the customer is already signed in via the session token, and
        // future app opens will simply show the OTP screen again.
        setBiometricNotice(
          "Your device doesn't have biometric unlock set up, so quick sign-in isn't available. You can still sign in with an OTP any time."
        );
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Enable quick sign-in with biometrics",
      });
      if (!result.success) return;
      const deviceId = await getOrCreateDeviceId();
      const { deviceToken } = await authApi.registerDevice(deviceId);
      await saveDeviceToken(deviceToken);
    } catch {
      // Device registration is best-effort — never block sign-in on it.
    }
  }

  async function handleVerifyOtp() {
    setError(null);
    setLoading(true);
    try {
      const session = await authApi.verifyOtp(phone.trim(), code.trim());
      await completeLogin(session);
      await enrollDeviceBiometric();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="padding">
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Image source={require("../../assets/ambika-gold.png")} style={styles.logo} resizeMode="contain" />
          <ThemedText variant="body" color={colors.muted} style={styles.subtitle}>
            Customer sign in
          </ThemedText>

          {step === "phone" ? (
            <>
              <GoldTextInput
                label="Registered phone number"
                keyboardType="phone-pad"
                autoCapitalize="none"
                value={phone}
                onChangeText={setPhone}
              />
              {error ? (
                <ThemedText variant="small" color={colors.red} style={styles.error}>
                  {error}
                </ThemedText>
              ) : null}
              <GoldButton title="Send OTP" onPress={handleRequestOtp} loading={loading} disabled={!phone.trim()} />
              {hasDeviceToken ? (
                <>
                  <ThemedText variant="small" color={colors.muted} style={styles.orDivider}>
                    or
                  </ThemedText>
                  <GoldButton
                    title="Login with biometric"
                    variant="outline"
                    onPress={handleBiometricLogin}
                    loading={biometricLoading}
                  />
                </>
              ) : null}
            </>
          ) : (
            <>
              <ThemedText variant="small" color={colors.muted} style={styles.otpHint}>
                Enter the 6-digit code sent to your phone via WhatsApp.
              </ThemedText>
              <GoldTextInput
                label="OTP code"
                keyboardType="number-pad"
                maxLength={6}
                value={code}
                onChangeText={setCode}
              />
              {error ? (
                <ThemedText variant="small" color={colors.red} style={styles.error}>
                  {error}
                </ThemedText>
              ) : null}
              {biometricNotice ? (
                <ThemedText variant="small" color={colors.muted} style={styles.error}>
                  {biometricNotice}
                </ThemedText>
              ) : null}
              <GoldButton title="Verify & Sign in" onPress={handleVerifyOtp} loading={loading} disabled={code.trim().length !== 6} />
              <GoldButton
                title="Resend code"
                variant="outline"
                onPress={handleRequestOtp}
                loading={loading}
                style={styles.resend}
              />
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
  logo: { width: "86%", height: 200, alignSelf: "center", marginBottom: 4 },
  subtitle: { marginBottom: 24, textAlign: "center" },
  otpHint: { marginBottom: 12 },
  orDivider: { textAlign: "center", marginVertical: 10 },
  error: { marginBottom: 12 },
  resend: { marginTop: 10 },
});
