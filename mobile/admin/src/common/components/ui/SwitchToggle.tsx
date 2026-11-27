import { Pressable, View } from "react-native";
import { C } from "./base";

type SwitchToggleProps = {
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
};

/** App-themed on/off switch (replaces the native Switch, which uses the OS look). */
export function SwitchToggle({ value, onValueChange, disabled }: SwitchToggleProps) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={() => onValueChange(!value)}
      style={{
        width: 44,
        height: 26,
        borderRadius: 13,
        padding: 3,
        justifyContent: "center",
        alignItems: value ? "flex-end" : "flex-start",
        backgroundColor: value ? C.brandDeep : C.line,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" }} />
    </Pressable>
  );
}
