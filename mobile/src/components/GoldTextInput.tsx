import React from "react";
import { TextInput, TextInputProps, View, StyleSheet, Pressable } from "react-native";
import { colors } from "../theme/colors";
import { typeScale } from "../theme/typography";
import { ThemedText } from "./ThemedText";

// `right` renders an accessory (e.g. the show/hide-password eye toggle)
// inside the input's right edge without every caller reimplementing the
// positioning — see login.tsx/reset-password.tsx for the password case.
export function GoldTextInput({
  label,
  style,
  right,
  ...rest
}: TextInputProps & { label?: string; right?: React.ReactNode }) {
  return (
    <View style={styles.wrap}>
      {label ? (
        <ThemedText variant="label" color={colors.muted} style={styles.label}>
          {label}
        </ThemedText>
      ) : null}
      <View style={styles.inputRow}>
        <TextInput
          placeholderTextColor={colors.muted}
          style={[styles.input, right ? styles.inputWithRight : null, style]}
          {...rest}
        />
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
  input: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    fontFamily: typeScale.body.fontFamily,
    fontSize: typeScale.body.fontSize,
    color: colors.ink,
  },
  inputWithRight: { paddingRight: 56 },
  right: { position: "absolute", right: 14 },
});
