import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, Image, Pressable, Platform, Animated, Easing, Keyboard, useWindowDimensions, ScrollView, KeyboardAvoidingView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsFocused } from "expo-router";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { useTheme } from "@/common/theme/ThemeProvider";
import type { Colors } from "@/common/theme/colors";
import { ThemedText } from "@/common/components/ui/ThemedText";
import { Icon } from "@/common/components/ui/Icon";
import { HEADER_LOGO } from "@/common/config/brand";
import { styles } from "./authKitStyles";

// Shared building blocks for the (auth) screens — login, forgot password and
// reset password all use the same angled brand panel, inputs and button so
// the three read as one flow.

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
  // The form's height before anything was added to it (an error box): a form that fit
  // then must not start scrolling just because an error appeared.
  const [baseFormH, setBaseFormH] = useState(0);
  const bodyPad = (keyboardOpen ? 0 : insets.bottom) + 28 + 8;
  const preferred = Math.round(Math.min(compact ? 280 : 350, windowHeight * (compact ? 0.34 : 0.42))) + insets.top;
  // Never shorter than the heading itself: the panel's bottom edge is a
  // diagonal (80% of its height at the right, 100% at the left), so a floor
  // below the heading's height cut "Good to see you again." in half. The
  // heading's right end sits well left of the edge, so ~84% clears it.
  const floor = Math.max(insets.top + (compact ? 150 : 190), heroH ? Math.ceil(heroH / 0.84) : 0);
  // Not shrunk to fit the form: Login's taller form used to squeeze its hero
  // shorter than Forgot password's. Every screen now gets the same hero
  // height, and a form that doesn't fit beneath it scrolls (needsScroll).
  const fitted = Math.max(floor, preferred);
  const growth = !keyboardOpen && baseFormH ? Math.max(0, formH - baseFormH) : 0;
  const baseFits = baseFormH > 0 && fitted + baseFormH + bodyPad <= windowHeight + 1;
  const shrink = baseFits ? Math.min(growth, fitted - floor) : 0;
  const panelHeight = keyboardOpen ? insets.top + 96 : fitted - shrink;
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
          <View
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              setFormH(h);
              if (!keyboardOpen) setBaseFormH((b) => b || h);
            }}
          >
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
type BrandPanelProps = { colors: Colors };

// Brand gradient cut on a diagonal, with rings and a stripe for texture.
function BrandPanel({ colors }: BrandPanelProps) {
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
