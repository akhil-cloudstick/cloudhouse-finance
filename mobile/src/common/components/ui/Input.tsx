import { SELECTION_COLOR } from "@/common/theme/colors";
import React, { useState } from "react";
import { TextInput, type TextInputInstance, type TextInputProps } from "react-native";
import { C } from "./base";
import { doneBarFor } from "./KeyboardDoneBar";
import { textStyle } from "@/common/theme/typography";
import { s } from "./formHelpers";

/** .field input */
export function Input({ style, editable = true, ...rest }: TextInputProps & { ref?: React.Ref<TextInputInstance> }) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={C.placeholder}
      cursorColor={C.brand}
      selectionColor={SELECTION_COLOR}
      autoComplete="off"
      importantForAutofill="no"
      textContentType="none"
      autoCorrect={false}
      spellCheck={false}
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
