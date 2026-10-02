import React, { useEffect, useState } from "react";
import { BackHandler, Keyboard, StyleSheet, View } from "react-native";
import { useAuth } from "../../src/auth/AuthContext";
import { ApiError } from "../../src/api/client";
import { getBusinessCode, isValidBusinessCode, normalizeBusinessCode } from "../../src/auth/businessCode";
import { forgotPassword, resetPassword } from "../../src/api/auth";
import { useTheme } from "../../src/theme/ThemeProvider";
import { ThemedText } from "../../src/components/ThemedText";
import { Icon } from "../../src/components/Icon";
import { ConfirmSheet } from "../../src/components/ui";
import {
  AuthShell,
  AuthField,
  AuthButton,
  AuthError,
  AuthLink,
  KeyboardAnchor,
  OtpInput,
  PasswordEye,
  SecureNote,
} from "../../src/components/AuthKit";

// Login, Forgot password and Reset password used to be three separate
// routes (a native-stack push for "Forgot password?", another for "Enter
// the code"), sharing one visual shell (AuthShell). That meant every step
// between them was a real native screen transition — and on Android, going
// BACK through one (particularly Forgot → Login, right after the keyboard
// had been up) reliably showed a white flash: the native screen surface
// being un/re-attached, or the OS keyboard still closing over the newly
// revealed screen, however carefully the transition and the keyboard were
// managed on the JS side.
//
// There's now only one route, and no native transition between these steps
// at all — just this one screen, always mounted, switching what it shows
// via local state. A `phase` NAVIGATION STACK (not React Navigation, just
// an array) plays the same role a real stack would: pushed to go forward,
// popped by hardware Back or by the "Back to sign in" / "Use a different
// number" links. Nothing here can flash, because nothing is
// ever un/remounted or handed to a native screen transition to swap.
// Resetting is two steps of its own — the SMS code ("otp"), then the new
// password ("reset") — sent to the server together on the last one (there
// is no separate verify-code call).
type Phase = "login" | "forgot" | "otp" | "reset";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const { colors } = useTheme();
  const [stack, setStack] = useState<Phase[]>(["login"]);
  const phase = stack[stack.length - 1];

  const push = (p: Phase) => {
    Keyboard.dismiss();
    setStack((s) => [...s, p]);
  };
  const pop = () => {
    Keyboard.dismiss();
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  };
  const goLogin = () => {
    Keyboard.dismiss();
    setStack(["login"]);
  };

  // Hardware Back walks the phase stack, same as a real navigator would;
  // at the root ("login") it's untouched, so Android's own default (leave
  // the app) applies exactly as it did with the old separate screens.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (stack.length > 1) {
        pop();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stack.length]);

  // ---- Login --------------------------------------------------------------
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // The business the connect screen (QR scan / typed code) stored — this
  // screen is only reachable once there is one. "Exit business" below
  // forgets it and returns to the scanner.
  const { businessCode, exitBusiness } = useAuth();
  const { businessName } = useTheme();

  // Confirmed in the app's own sheet — a native Alert showed Android's
  // stock dialog here.
  const [confirmExit, setConfirmExit] = useState(false);

  async function handleSignIn() {
    Keyboard.dismiss();
    setLoginError(null);
    const code = normalizeBusinessCode(businessCode);
    if (code && !isValidBusinessCode(code)) {
      setLoginError("That business code doesn't look right — letters, numbers and dashes only.");
      return;
    }
    setLoading(true);
    try {
      await signIn(identifier.trim(), password, code);
    } catch (err) {
      if (err instanceof ApiError) setLoginError(err.message);
      else setLoginError("Could not reach the server. Check your connection and try again.");
      setLoading(false);
    }
  }

  // ---- Forgot password ------------------------------------------------------
  // Mirrors frontend/app/forgot-password/page.tsx: the backend never reveals
  // whether a phone number is registered (see backend/internal/auth/handler.go's
  // ForgotPassword comment), so this always shows the same generic "sent"
  // message regardless of the actual result — never surface the request's
  // error to the user, for the same reason the web version swallows it.
  const [phone, setPhone] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSendCode() {
    Keyboard.dismiss();
    setSendingCode(true);
    try {
      const code = await getBusinessCode();
      await forgotPassword(phone.trim(), code).catch(() => {});
    } finally {
      setSendingCode(false);
      setSent(true);
    }
  }

  // ---- Reset password --------------------------------------------------------
  // The phone number is fixed to whatever "Forgot password" requested a code
  // for and is NOT re-typable here — see frontend/app/reset-password/page.tsx's
  // comment: a free-text phone field here would let someone request a code
  // for their own number, then swap in a different target phone before
  // submitting the OTP, turning "forgot my own password" into "reset
  // anyone's password given their phone number and a leaked/guessed code".
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  async function handleResetPassword() {
    Keyboard.dismiss();
    setResetError(null);
    if (newPassword.length < 8) {
      setResetError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetError("Passwords do not match.");
      return;
    }
    setResetting(true);
    try {
      const code = await getBusinessCode();
      await resetPassword(phone.trim(), otp.trim(), newPassword, code);
      // Land back on Login (with the fields it had before) to sign in with
      // the new password — same place the old dismissTo("/login") did.
      setOtp("");
      setNewPassword("");
      setConfirmPassword("");
      setSent(false);
      setPhone("");
      goLogin();
    } catch (err) {
      setResetError(err instanceof ApiError ? err.message || "This code is invalid or has expired." : "This code is invalid or has expired.");
      setResetting(false);
    }
  }

  if (phase === "otp") {
    return (
      <AuthShell eyebrow="Verify" title={"Enter the\ncode."} subtitle={`Enter the 6-digit code sent to ${phone.trim()}.`}>
        <OtpInput value={otp} onChange={setOtp} />
        <View style={styles.spacer} />
        <KeyboardAnchor>
          <AuthButton
            title="Continue"
            onPress={() => {
              setResetError(null);
              push("reset");
            }}
            disabled={otp.length < 6}
          />
        </KeyboardAnchor>
        <AuthLink label="Back to sign in" onPress={goLogin} />
      </AuthShell>
    );
  }

  if (phase === "reset") {
    return (
      <AuthShell eyebrow="Reset password" title={"Set a new\npassword."} subtitle="Choose a password with at least 8 characters.">
        <AuthField
          label="New password"
          icon="lock"
          placeholder="At least 8 characters"
          secureTextEntry={!showNewPassword}
          value={newPassword}
          onChangeText={setNewPassword}
          right={<PasswordEye visible={showNewPassword} onToggle={() => setShowNewPassword((v) => !v)} />}
        />
        <AuthField
          label="Confirm password"
          icon="lock"
          placeholder="Re-enter the password"
          secureTextEntry={!showConfirmPassword}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          right={<PasswordEye visible={showConfirmPassword} onToggle={() => setShowConfirmPassword((v) => !v)} />}
        />

        <AuthError message={resetError} />

        <KeyboardAnchor>
          <AuthButton
            title="Set new password"
            onPress={handleResetPassword}
            disabled={!newPassword || !confirmPassword}
            loading={resetting}
          />
        </KeyboardAnchor>
        {/* A rejected reset is almost always a mistyped or expired code. */}
        <AuthLink label={resetError ? "Re-enter the code" : "Back to sign in"} onPress={resetError ? pop : goLogin} />
      </AuthShell>
    );
  }

  if (phase === "forgot") {
    if (sent) {
      return (
        <AuthShell eyebrow="Code sent" title={"Check your\nphone."}>
          <View style={[styles.sentCard, { backgroundColor: colors.bg }]}>
            <View style={[styles.sentIcon, { backgroundColor: colors.greenBg }]}>
              <Icon name="check" size={22} color={colors.green} />
            </View>
            <ThemedText variant="body" color={colors.ink} style={styles.sentText}>
              If{" "}
              <ThemedText variant="body" color={colors.ink} style={styles.bold}>
                {phone.trim()}
              </ThemedText>{" "}
              is registered, a 6-digit reset code has been sent by SMS.
            </ThemedText>
          </View>
          <KeyboardAnchor>
            <AuthButton title="Enter the code" onPress={() => push("otp")} />
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
          <AuthButton title="Send reset code" onPress={handleSendCode} disabled={!phone.trim()} loading={sendingCode} />
        </KeyboardAnchor>
        <AuthLink label="Back to sign in" onPress={pop} />
      </AuthShell>
    );
  }

  return (
    <AuthShell eyebrow="Staff portal" title={"Good to see\nyou again."} subtitle={`Sign in to ${businessName} with your username and password.`}>
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

      <AuthLink label="Forgot password?" align="right" onPress={() => push("forgot")} />

      <AuthError message={loginError} />

      <KeyboardAnchor>
        <AuthButton title="Sign in" onPress={handleSignIn} disabled={!identifier || !password} loading={loading} />
      </KeyboardAnchor>

      <AuthLink label="Exit business" onPress={() => setConfirmExit(true)} />

      <SecureNote />

      <ConfirmSheet
        visible={confirmExit}
        onClose={() => setConfirmExit(false)}
        title="Exit business?"
        message={`You'll need to scan ${businessName}'s QR code (or enter its business code) again to sign in.`}
        confirmLabel="Exit business"
        danger
        onConfirm={() => {
          setConfirmExit(false);
          exitBusiness();
        }}
      />
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
