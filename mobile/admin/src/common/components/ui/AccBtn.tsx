import { Pressable, type StyleProp, type ViewStyle } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { AccAction, s } from "./rowContext";

/** .acc-btn */
export function AccBtn({ label, onPress, primary, danger, disabled, style }: AccAction & { style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[s.btn, primary && s.btnPrimary, disabled && { opacity: 0.5 }, style]}>
      <Txt style={[s.btnTxt, primary && { color: "#fff" }, danger && { color: C.red }]} numberOfLines={1}>
        {label}
      </Txt>
    </Pressable>
  );
}
