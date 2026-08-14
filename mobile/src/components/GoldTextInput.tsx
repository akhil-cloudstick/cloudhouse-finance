import React from "react";
import { TextInput, TextInputProps, View, StyleSheet } from "react-native";
import { colors } from "../theme/colors";
import { typeScale } from "../theme/typography";
import { ThemedText } from "./ThemedText";

export function GoldTextInput({ label, style, ...rest }: TextInputProps & { label?: string }) {
  return (
    <View style={styles.wrap}>
      {label ? (
        <ThemedText variant="label" color={colors.muted} style={styles.label}>
          {label}
        </ThemedText>
      ) : null}
      <TextInput
        placeholderTextColor={colors.muted}
        style={[styles.input, style]}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { marginBottom: 6 },
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
});
