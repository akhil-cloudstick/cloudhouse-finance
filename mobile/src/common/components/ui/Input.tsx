import React, { useState } from "react";
import { TextInput, type TextInputProps } from "react-native";
import { C } from "./base";
import { doneBarFor } from "./KeyboardDoneBar";
import { textStyle } from "@/common/theme/typography";
import { s } from "./formHelpers";

/** .field input */
export function Input({ style, editable = true, ...rest }: TextInputProps & { ref?: React.Ref<TextInput> }) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={C.placeholder}
      autoComplete="off"
      importantForAutofill="no"
      textContentType="none"
      allowFontScaling={false}
      editable={editable}
      inputAccessoryViewID={doneBarFor(rest.keyboardType)}
      {...rest}
      onFocus={(e) => {
        setFocused(true);
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        rest.onBlur?.(e);
      }}
      style={textStyle([s.input, focused && s.inputFocus, !editable && s.inputDisabled, style], false)}
    />
  );
}
