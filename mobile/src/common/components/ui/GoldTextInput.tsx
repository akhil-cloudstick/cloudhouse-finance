import React from "react";
import { TextInput, TextInputProps, View, StyleSheet, ViewStyle, StyleProp, Platform } from "react-native";
import { BlurView } from "expo-blur";
import { colors } from "@/common/theme/colors";
import { typeScale, textStyle } from "@/common/theme/typography";
import { ThemedText } from "./ThemedText";
import { doneBarFor } from "./KeyboardDoneBar";

// `containerStyle` (not `style`, which only moves the input box) keeps the label aligned with the input.
// `blur` is iOS-only here: Android needs a `blurTarget` wiring we don't have, so it gets a plain tint.
export function GoldTextInput({
  label,
  style,
  containerStyle,
  right,
  blur,
  invalid,
  ...rest
}: TextInputProps & {
  label?: string;
  right?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  blur?: boolean;
  // Deliberately more saturated red than colors.red, for a flagged-wrong value.
  invalid?: boolean;
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
          style={[styles.inputBox, blur && styles.inputBoxBlur, invalid && styles.inputBoxInvalid]}
          {...(blur && Platform.OS === "ios" ? { intensity: 30, tint: "light" as const } : {})}
        >
          <TextInput
            placeholderTextColor={colors.placeholder}
            autoComplete="off"
            importantForAutofill="no"
            textContentType="none"
            style={textStyle([styles.input, right ? styles.inputWithRight : null, style], false)}
            inputAccessoryViewID={doneBarFor(rest.keyboardType)}
            {...rest}
          />
        </InputSurface>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { marginBottom: 6 },
  inputRow: { position: "relative", justifyContent: "center" },
  // BlurView can't be the input's own backgroundColor, so it wraps the TextInput instead.
  inputBox: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    justifyContent: "center",
  },
  inputBoxBlur: { backgroundColor: "rgba(255, 253, 247, 0.55)", overflow: "hidden" },
  inputBoxInvalid: { borderColor: "#ef4444", borderWidth: 1.5 },
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
