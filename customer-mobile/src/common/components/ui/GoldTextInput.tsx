import React from "react";
import { TextInput, TextInputProps, View, StyleSheet, ViewStyle, StyleProp } from "react-native";
import { colors } from "@/common/theme/colors";
import { typeScale } from "@/common/theme/typography";
import { ThemedText } from "./ThemedText";

export function GoldTextInput({
  label,
  style,
  containerStyle,
  right,
  ...rest
}: TextInputProps & { label?: string; right?: React.ReactNode; containerStyle?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.wrap, containerStyle]}>
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
