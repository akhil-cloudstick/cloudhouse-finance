import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  Image,
  Pressable,
  TextInput,
  TextInputProps,
  ActivityIndicator,
  Platform,
  Animated,
  Easing,
  Keyboard,
  useWindowDimensions,
  ScrollView,
  KeyboardAvoidingView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsFocused } from "expo-router";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { typeScale } from "../theme/typography";
import { useTheme } from "../theme/ThemeProvider";
import { ThemedText } from "./ThemedText";
import { Icon } from "./Icon";
import { HEADER_LOGO } from "../config/brand";
import { doneBarFor } from "./ui/KeyboardDone";

// Shared building blocks for the (auth) screens — login, forgot password and
// reset password all use the same angled brand panel, inputs and button so
// the three read as one flow.

type Colors = ReturnType<typeof useTheme>["colors"];

// ---------------------------------------------------------------------------
// Keyboard handling
//
// Deliberately boring: a KeyboardAvoidingView pads the screen by the
// keyboard's height, and the brand panel collapses to a slim bar while the
// keyboard is up so the form and its button fit above it. Everything is a
// plain layout change. Earlier versions moved the form with a native-driver
// transform, then with an animated ScrollView.scrollTo + LayoutAnimation —
// both broke taps on Android: a transform leaves touch targets at the old
// positions, and while a ScrollView is animating it captures every tap
// (ScrollView._handleStartShouldSetResponderCapture → _isAnimating), so the
// input never received the press and the keyboard bounced.

/** Kept so screens can mark their primary button; layout needs no measuring. */
export function KeyboardAnchor({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}


// ---------------------------------------------------------------------------
// Shell

type ShellProps = {
  eyebrow: string;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  /** Shorter brand panel for screens with a taller form. */
  compact?: boolean;
  children: React.ReactNode;
};

export function AuthShell({ eyebrow, title, subtitle, onBack, compact, children }: ShellProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const enter = useRef(new Animated.Value(0)).current;
  const [keyboardState, setKeyboardOpen] = useState(false);
  // Login stays mounted under Forgot/Reset password. Reacting to the
  // keyboard opened on those screens left it collapsed (compact panel,
  // keyboard padding) underneath, so going back showed it snap open — a
  // white flash. Only the visible screen follows the keyboard.
  const focused = useIsFocused();
  const keyboardOpen = focused && keyboardState;
  const [wasFocused, setWasFocused] = useState(focused);
  if (wasFocused !== focused) {
    setWasFocused(focused);
    if (!focused) setKeyboardOpen(false);
  }

  // Window height (the screen minus system bars) — "screen" height included
  // the navigation bar, so on large-display-size / big-font phones the page
  // came out taller than the view and had to scroll. The brand panel now
  // gives way to the form: it takes its preferred height only when the form
  // still fits beneath it, and shrinks (down to a floor) when it wouldn't.
  const windowHeight = useWindowDimensions().height;
  const [formH, setFormH] = useState(0);
  const [heroH, setHeroH] = useState(0);
  const bodyPad = (keyboardOpen ? 0 : insets.bottom) + 28 + 8;
  const preferred = Math.round(Math.min(compact ? 280 : 350, windowHeight * (compact ? 0.34 : 0.42))) + insets.top;
  // Never shorter than the heading itself: the panel's bottom edge is a
  // diagonal (80% of its height at the right, 100% at the left), so a floor
  // below the heading's height cut "Good to see you again." in half. The
  // heading's right end sits well left of the edge, so ~84% clears it.
  const floor = Math.max(insets.top + (compact ? 150 : 190), heroH ? Math.ceil(heroH / 0.84) : 0);
  const fitted = formH ? Math.max(floor, Math.min(preferred, windowHeight - formH - bodyPad)) : preferred;
  const panelHeight = keyboardOpen ? insets.top + 96 : fitted;
  const needsScroll = keyboardOpen || !formH || panelHeight + formH + bodyPad > windowHeight + 1;

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter]);

  useEffect(() => {
    if (!focused) return;
    const ios = Platform.OS === "ios";
    const subs = [
      Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", () => setKeyboardOpen(true)),
      Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setKeyboardOpen(false)),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [focused]);

  // Entrance only touches the brand panel's contents — never the form.
  const anim = useMemo(() => {
    const range = (from: number) => [from, Math.min(1, from + 0.55)];
    const rise = (from: number) => ({
      opacity: enter.interpolate({ inputRange: range(from), outputRange: [0, 1], extrapolate: "clamp" }),
      transform: [{ translateY: enter.interpolate({ inputRange: range(from), outputRange: [22, 0], extrapolate: "clamp" }) }],
    });
    return { top: rise(0), heading: rise(0.08) };
  }, [enter]);

  return (
    <KeyboardAvoidingView style={[styles.screen, { backgroundColor: colors.card }]} behavior="padding" enabled={focused}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
        scrollEnabled={needsScroll}
      >
        <View style={{ height: panelHeight }}>
          <BrandPanel colors={colors} />
          <View
            style={[styles.hero, { paddingTop: insets.top + (keyboardOpen ? 16 : 20) }]}
            onLayout={(e) => {
              if (!keyboardOpen) setHeroH(e.nativeEvent.layout.height);
            }}
          >
            <Animated.View style={[styles.heroTop, keyboardOpen && styles.heroTopCompact, anim.top]}>
              <View style={[styles.logoTile, keyboardOpen && styles.logoTileCompact]}>
                <Image
                  source={HEADER_LOGO}
                  resizeMode="contain"
                  style={keyboardOpen ? styles.logoCompact : styles.logo}
                />
              </View>
              {keyboardOpen ? (
                <ThemedText variant="h3" color="#ffffff" style={styles.compactTitle} numberOfLines={1}>
                  {title.replace(/\n/g, " ")}
                </ThemedText>
              ) : null}
              {onBack ? (
                <Pressable onPress={onBack} hitSlop={10} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}>
                  <Icon name="chevronLeft" size={20} color="#ffffff" />
                </Pressable>
              ) : null}
            </Animated.View>
            {keyboardOpen ? null : (
              <Animated.View style={anim.heading}>
                <View style={styles.chip}>
                  <ThemedText variant="small" color="#ffffff" style={styles.chipText}>
                    {eyebrow.toUpperCase()}
                  </ThemedText>
                </View>
                <ThemedText variant="h1" color="#ffffff" style={styles.title}>
                  {title}
                </ThemedText>
              </Animated.View>
            )}
          </View>
        </View>

        <View style={[styles.body, { paddingBottom: (keyboardOpen ? 0 : insets.bottom) + 28 }]}>
          <View onLayout={(e) => setFormH(e.nativeEvent.layout.height)}>
            {subtitle && !keyboardOpen ? (
              <ThemedText variant="body" color={colors.muted} style={styles.subtitle}>
                {subtitle}
              </ThemedText>
            ) : null}
            {children}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}


// Brand gradient cut on a diagonal, with rings and a stripe for texture.
function BrandPanel({ colors }: { colors: Colors }) {
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      // Login stays mounted under Forgot/Reset password, but Android's
      // native screen stack can still detach and later reattach its native
      // view surface. An SVG needs an extra native draw pass after that —
      // reattaching mid-navigation left this panel blank (plain white) for
      // a frame, read as a flash. Caching it as a texture (kept from its
      // last, already-drawn frame) avoids that redraw gap; collapsable
      // keeps Fabric from ever flattening it away in the first place.
      collapsable={false}
      renderToHardwareTextureAndroid
    >
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="authPanel" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.brandDeep} />
            <Stop offset="0.55" stopColor={colors.brand} />
            <Stop offset="1" stopColor={colors.brandMid} />
          </LinearGradient>
        </Defs>
        <Path d="M0 0 H100 V80 L0 100 Z" fill="url(#authPanel)" />
      </Svg>
      <View style={styles.decor}>
        <View style={[styles.ring, { width: 230, height: 230, right: -70, top: -50 }]} />
        <View style={[styles.ring, { width: 150, height: 150, right: -30, top: -10 }]} />
        <View style={[styles.ringFill, { width: 72, height: 72, right: 8, top: 30 }]} />
        <View style={styles.stripe} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Inputs

type FieldProps = TextInputProps & {
  ref?: React.Ref<TextInput>;
  label: string;
  icon: string;
  right?: React.ReactNode;
};

export function AuthField({ label, icon, right, onFocus, onBlur, ...rest }: FieldProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.fieldGroup}>
      <ThemedText variant="label" color={colors.ink} style={styles.fieldLabel}>
        {label}
      </ThemedText>
      <View
        // Always its own native view + stacking context, so no style change
        // can make Fabric re-parent the TextInput inside it.
        collapsable={false}
        style={[
          styles.field,
          focused
            ? { borderColor: colors.brand, backgroundColor: colors.card }
            : { borderColor: "transparent", backgroundColor: colors.bg },
        ]}
      >
        <View style={[styles.fieldIcon, { backgroundColor: focused ? colors.brandPale : colors.card }]}>
          <Icon name={icon} size={18} color={focused ? colors.brand : colors.muted} />
        </View>
        <TextInput
          placeholderTextColor={colors.muted}
          importantForAutofill="no"
          selectionColor={colors.brand}
          cursorColor={colors.brand}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.fieldInput, { color: colors.ink, fontFamily: typeScale.body.fontFamily }]}
          {...rest}
        />
        {right}
      </View>
    </View>
  );
}

export function PasswordEye({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onToggle} hitSlop={12} style={styles.eye}>
      <Icon name={visible ? "eye" : "eyeOff"} size={20} color={colors.muted} />
    </Pressable>
  );
}

// Six separate digit boxes over one hidden TextInput, so paste and SMS
// autofill still arrive in a single onChangeText.
export function OtpInput({ value, onChange, length = 6 }: { value: string; onChange: (v: string) => void; length?: number }) {
  const { colors } = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const active = Math.min(value.length, length - 1);

  return (
    <View style={styles.fieldGroup}>
      <ThemedText variant="label" color={colors.ink} style={styles.fieldLabel}>
        Verification code
      </ThemedText>
      <Pressable onPress={() => inputRef.current?.focus()} style={styles.otpRow}>
        {Array.from({ length }).map((_, i) => {
          const isActive = focused && i === active;
          const filled = i < value.length;
          return (
            <View
              key={i}
              style={[
                styles.otpBox,
                isActive
                  ? { borderColor: colors.brand, backgroundColor: colors.card }
                  : { borderColor: filled ? colors.brandPale : "transparent", backgroundColor: filled ? colors.brandFaint : colors.bg },
              ]}
            >
              <ThemedText variant="h3" color={colors.ink}>
                {value[i] ?? ""}
              </ThemedText>
            </View>
          );
        })}
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={(t) => onChange(t.replace(/\D/g, "").slice(0, length))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="number-pad"
          inputAccessoryViewID={doneBarFor("number-pad")}
          textContentType="oneTimeCode"
          maxLength={length}
          caretHidden
          importantForAutofill="no"
          style={styles.otpHidden}
        />
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Button, messages, links

type ButtonProps = { title: string; onPress: () => void; disabled?: boolean; loading?: boolean };

// Single solid-color button.
export function AuthButton({ title, onPress, disabled, loading }: ButtonProps) {
  const { colors } = useTheme();
  const off = disabled || loading;
  return (
    <View style={[styles.buttonShadow, { shadowColor: colors.brandMid }, disabled && styles.buttonShadowOff]}>
      <Pressable
        onPress={onPress}
        disabled={off}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: colors.brand },
          disabled && { opacity: 0.45 },
          pressed && !off && { transform: [{ scale: 0.98 }] },
        ]}
      >
        {loading ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <>
            <ThemedText variant="body" color="#ffffff" style={styles.buttonLabel}>
              {title}
            </ThemedText>
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M5 12h14M13 6l6 6-6 6" />
            </Svg>
          </>
        )}
      </Pressable>
    </View>
  );
}

export function AuthError({ message }: { message: string | null }) {
  const { colors } = useTheme();
  if (!message) return null;
  return (
    <View style={[styles.errorBox, { backgroundColor: colors.redBg }]}>
      <Icon name="warning" size={18} color={colors.red} />
      <ThemedText variant="body" color={colors.red} style={styles.errorText}>
        {message}
      </ThemedText>
    </View>
  );
}

export function AuthLink({ label, onPress, align = "center" }: { label: string; onPress: () => void; align?: "center" | "right" }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={8} style={align === "right" ? styles.linkRight : styles.linkCenter}>
      <ThemedText variant="label" color={align === "right" ? colors.brand : colors.muted} style={styles.linkText}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

export function SecureNote() {
  const { colors } = useTheme();
  return (
    <View style={styles.secureRow}>
      <Icon name="lock" size={14} color={colors.muted} />
      <ThemedText variant="small" color={colors.muted} style={styles.secureText}>
        Encrypted &amp; secure
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, overflow: "hidden" },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },

  decor: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, overflow: "hidden" },
  ring: { position: "absolute", borderRadius: 999, borderWidth: 2, borderColor: "rgba(255,255,255,0.16)" },
  ringFill: { position: "absolute", borderRadius: 999, backgroundColor: "rgba(255,255,255,0.1)" },
  stripe: {
    position: "absolute",
    left: -50,
    bottom: "34%",
    width: 260,
    height: 14,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.12)",
    transform: [{ rotate: "-12deg" }],
  },

  hero: { paddingHorizontal: 28 },
  heroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  heroTopCompact: { marginBottom: 0, gap: 12 },
  compactTitle: { flex: 1 },
  // No white backing tile any more — the logo (HEADER_LOGO, cut out on a
  // transparent background) sits straight on the hero gradient, matching
  // every page header (Shell.tsx's flatLogo/aId).
  logoTile: {
    width: 60,
    height: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: { width: 56, height: 56 },
  logoTileCompact: { width: 44, height: 44 },
  logoCompact: { width: 40, height: 40 },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
  chip: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
    marginBottom: 10,
  },
  chipText: { fontWeight: "700", letterSpacing: 1.4 },
  title: { fontSize: 34, lineHeight: 40, letterSpacing: -0.6 },

  body: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 8 },
  subtitle: { fontSize: 15, lineHeight: 21, marginBottom: 14 },

  fieldGroup: { marginBottom: 12 },
  fieldLabel: { fontSize: 14, fontWeight: "600", marginBottom: 6 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    height: 56,
    borderRadius: 18,
    borderWidth: 2,
    paddingLeft: 10,
    paddingRight: 14,
  },
  // No focus-only shadow on purpose: toggling shadowColor/elevation/opacity on a
  // view that CONTAINS a TextInput flips it in and out of being a Fabric
  // "stacking context", which detaches and re-attaches its children —
  // Android then drops the input's focus and jumps to the next field
  // (see the diagnostics: FOCUS Username → BLUR → FOCUS Password …).
  fieldIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  fieldInput: { flex: 1, height: "100%", fontSize: 17, paddingVertical: 0 },
  eye: { padding: 6 },

  otpRow: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  otpBox: { flex: 1, height: 62, borderRadius: 16, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  otpHidden: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, opacity: 0.011, color: "transparent" },

  buttonShadow: { borderRadius: 18, shadowOpacity: 0.45, shadowRadius: 16, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  buttonShadowOff: { shadowOpacity: 0, elevation: 0 },
  button: {
    height: 58,
    borderRadius: 18,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  buttonLabel: { fontSize: 17, fontWeight: "700", letterSpacing: 0.2 },

  errorBox: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 14, padding: 12, marginBottom: 12 },
  errorText: { flex: 1, fontSize: 14, lineHeight: 20 },

  linkRight: { alignSelf: "flex-end", marginTop: -2, marginBottom: 14 },
  linkCenter: { alignSelf: "center", marginTop: 14, paddingVertical: 4 },
  linkText: { fontSize: 15, fontWeight: "600" },

  secureRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 12 },
  secureText: { fontSize: 13 },
});
