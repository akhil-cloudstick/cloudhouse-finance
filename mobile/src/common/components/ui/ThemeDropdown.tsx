import { useState } from "react";
import { Keyboard, Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { Popover, useAnchor, type Anchor } from "./Popover";
import { s } from "./formHelpers";
import { Chevron } from "./Chevron";
import { MenuItem } from "./MenuItem";

type ThemeDropdownProps<T> = {
  value: T | null | undefined;
  options: T[];
  onChange: (v: T) => void;
  labelOf: (v: T) => string;
  keyOf?: (v: T) => string | number;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
};

// ---- .theme-dropdown ------------------------------------------------------
// A normal dropdown: the field keeps its place in the form (same height as
// an input), the list opens right under it — or above when there's no room
// — over everything else (Popover.tsx), and closes on a pick or any tap
// outside. Opening it never changes the height of the card around it.
export function ThemeDropdown<T>({
  value,
  options,
  onChange,
  labelOf,
  keyOf,
  placeholder = "Select",
  style,
}: ThemeDropdownProps<T>) {
  const { ref, measure } = useAnchor();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const close = () => setAnchor(null);
  const openMenu = () => {
    Keyboard.dismiss();
    measure(setAnchor);
  };
  return (
    <View style={style}>
      <View ref={ref} collapsable={false}>
        <Pressable style={[s.input, s.dateBtn, anchor && s.inputFocus]} onPress={() => (anchor ? close() : openMenu())}>
          <Txt style={[s.ddValue, value == null && { color: C.muted }]} numberOfLines={1}>
            {value != null ? labelOf(value) : placeholder}
          </Txt>
          <Chevron open={!!anchor} />
        </Pressable>
      </View>
      <Popover anchor={anchor} onClose={close} onRemeasure={() => measure(setAnchor)}>
        {options.length === 0 ? <Txt style={[s.ddItemTxt, { padding: 10, color: C.muted }]}>No options</Txt> : null}
        {options.map((o, i) => {
          const selected = value != null && (keyOf ? keyOf(o) === keyOf(value) : o === value);
          return (
            <MenuItem
              key={keyOf ? keyOf(o) : i}
              title={labelOf(o)}
              selected={selected}
              onPress={() => {
                onChange(o);
                close();
              }}
            />
          );
        })}
      </Popover>
    </View>
  );
}
