import React, { useRef, useState } from "react";
import { Keyboard, Pressable, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";
import { Popover, useAnchor, type Anchor } from "./Popover";
import { Input } from "./Input";
import { s } from "./formHelpers";
import { Chevron } from "./Chevron";

type ComboInputProps = {
  value: string;
  onChangeText: (v: string) => void;
  menu: (close: () => void) => React.ReactNode | null;
  /** Called whenever the list closes (pick, outside tap, back). */
  onClosed?: () => void;
  /** Called when the field gains focus. */
  onOpened?: () => void;
  placeholder?: string;
  keyboardType?: TextInputProps["keyboardType"];
  style?: StyleProp<ViewStyle>;
  inputStyle?: TextInputProps["style"];
};

/** Typeable dropdown (karat, fineness, ornament type): a normal input with
 * a chevron; while it's focused the suggestions open under it. `menu`
 * returns the rows (or null for none); call `close` after a pick. */
export function ComboInput({
  value,
  onChangeText,
  menu,
  onClosed,
  onOpened,
  placeholder,
  keyboardType,
  style,
  inputStyle,
}: ComboInputProps) {
  const { ref, measure } = useAnchor();
  const input = useRef<TextInput>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const close = () => {
    setAnchor(null);
    input.current?.blur();
    Keyboard.dismiss();
    onClosed?.();
  };
  const body = anchor ? menu(close) : null;
  return (
    <View ref={ref} collapsable={false} style={style}>
      <Input
        ref={input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        autoCorrect={false}
        onFocus={() => {
          onOpened?.();
          measure(setAnchor);
        }}
        onBlur={() => {
          if (anchor) {
            setAnchor(null);
            onClosed?.();
          }
        }}
        style={[{ paddingRight: 38 }, inputStyle]}
      />
      <Pressable style={s.comboChev} hitSlop={8} onPress={() => (anchor ? close() : input.current?.focus())} accessibilityLabel="Show options">
        <Chevron open={!!anchor} />
      </Pressable>
      <Popover anchor={body != null ? anchor : null} onClose={close} onRemeasure={() => measure(setAnchor)} maxHeight={240} awaitKeyboard>
        {body}
      </Popover>
    </View>
  );
}
