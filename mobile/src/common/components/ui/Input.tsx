import React, { useState } from "react";
import { TextInput, type TextInputProps } from "react-native";
import { C } from "./base";
import { doneBarFor } from "./KeyboardDoneBar";
import { s } from "./formHelpers";

/** .field input */
export function Input({ style, editable = true, ...rest }: TextInputProps & { ref?: React.Ref<TextInput> }) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={C.muted}
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
      style={[s.input, focused && s.inputFocus, !editable && s.inputDisabled, style]}
    />
  );
}
