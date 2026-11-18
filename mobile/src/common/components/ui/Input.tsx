import { SELECTION_COLOR } from "@/common/theme/colors";
import React, { useState } from "react";
import { TextInput, type TextInputInstance, type TextInputProps } from "react-native";
import { C } from "./base";
import { doneBarFor } from "./KeyboardDoneBar";
import { textStyle } from "@/common/theme/typography";
import { s } from "./formHelpers";
import { useHoldTip } from "./TipHost";

/** .field input */
export function Input({ style, editable = true, ...rest }: TextInputProps & { ref?: React.Ref<TextInputInstance> }) {
  const [focused, setFocused] = useState(false);
  // Hold the box for its full text: what was typed (a long value is cut off by the width), else its placeholder.
  const hold = useHoldTip(() => (rest.value ? String(rest.value) : rest.placeholder));
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
      onTouchStart={(e) => {
        hold.onTouchStart(e);
        rest.onTouchStart?.(e);
      }}
      onTouchMove={(e) => {
        hold.onTouchMove(e);
        rest.onTouchMove?.(e);
      }}
      onTouchEnd={(e) => {
        hold.onTouchEnd();
        rest.onTouchEnd?.(e);
      }}
      onTouchCancel={(e) => {
        hold.onTouchCancel();
        rest.onTouchCancel?.(e);
      }}
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
