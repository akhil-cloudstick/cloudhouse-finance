import { Pressable, type StyleProp, type ViewStyle } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { s } from "./formHelpers";

type DashedButtonProps = { label: string; onPress: () => void; style?: StyleProp<ViewStyle> };

/** .add-ornament-btn — dashed add button. */
export function DashedButton({ label, onPress, style }: DashedButtonProps) {
  return (
    <Pressable style={[s.dashed, style]} onPress={onPress}>
      <PIcon name="plus" color={C.brandDeep} />
      <Txt style={s.dashedTxt}>{label}</Txt>
    </Pressable>
  );
}
