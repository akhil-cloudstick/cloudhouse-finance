import React from "react";
import { TextInput, TextInputProps, View, StyleSheet, Pressable, ViewStyle, StyleProp, Platform } from "react-native";
import { BlurView } from "expo-blur";
import { colors } from "../theme/colors";
import { typeScale } from "../theme/typography";
import { ThemedText } from "./ThemedText";

// `right` renders an accessory (e.g. the show/hide-password eye toggle)
// inside the input's right edge without every caller reimplementing the
// positioning — see login.tsx/reset-password.tsx for the password case.
// `containerStyle` positions the label + input together — use it (never
// `style`, which only moves the input box) for insets like the
// `paddingHorizontal: 16` full-bleed list screens apply, otherwise the
// label stays flush left while the input shifts and they look misaligned.
// `blur` swaps the field's solid fill for a translucent one — used on the
// search bars that sit right under FloatingHeader (see loans/customers/
// schemes list screens), matching that header's glass look. Real Android
// blur (`blurMethod="dimezisBlurView"`) needs an explicit `blurTarget` ref
// onto a `BlurTargetView` wrapping whatever should be sampled, which isn't
// wired up here — without it expo-blur falls back to no blur but keeps
// warning about it on every render, so Android just gets the translucent
// tint with no blur prop at all. iOS's BlurView blurs natively without
// that wiring.
export function GoldTextInput({
  label,
  style,
  containerStyle,
  right,
  blur,
  ...rest
}: TextInputProps & {
  label?: string;
  right?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  blur?: boolean;
}) {
  const InputSurface = blur && Platform.OS === "ios" ? BlurView : View;
  return (
    <View style={[styles.wrap, containerStyle]}>
      {label ? (
        <ThemedText variant="label" color={colors.muted} style={styles.label}>
          {label}
        </ThemedText>
      ) : null}
      <View style={styles.inputRow}>
        <InputSurface
          style={[styles.inputBox, blur && styles.inputBoxBlur]}
          {...(blur && Platform.OS === "ios" ? { intensity: 30, tint: "light" as const } : {})}
        >
          <TextInput
            placeholderTextColor={colors.muted}
            style={[styles.input, right ? styles.inputWithRight : null, style]}
            {...rest}
          />
        </InputSurface>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </View>
  );
}

// Convenience eye toggle for password fields — <GoldTextInput secureTextEntry
// right={<PasswordToggle visible={show} onToggle={() => setShow(v => !v)} />} .../>
export function PasswordToggle({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  return (
    <Pressable onPress={onToggle} hitSlop={10}>
      <ThemedText variant="label" color={colors.muted}>
        {visible ? "Hide" : "Show"}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { marginBottom: 6 },
  inputRow: { position: "relative", justifyContent: "center" },
  // Wraps the TextInput so `blur` mode can put a BlurView in charge of the
  // box's fill (border/radius/height) while the TextInput itself stays
  // transparent — a BlurView can't be the input's own backgroundColor.
  inputBox: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    justifyContent: "center",
  },
  inputBoxBlur: { backgroundColor: "rgba(255, 253, 247, 0.55)", overflow: "hidden" },
  input: {
    flex: 1,
    height: "100%",
    paddingHorizontal: 14,
    fontFamily: typeScale.body.fontFamily,
    fontSize: typeScale.body.fontSize,
    color: colors.ink,
  },
  inputWithRight: { paddingRight: 56 },
  right: { position: "absolute", right: 14 },
});
