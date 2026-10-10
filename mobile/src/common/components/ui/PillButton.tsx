import { Pressable, type StyleProp, type ViewStyle } from "react-native";
import { Txt } from "./Txt";
import { s } from "./chipTones";

type PillButtonProps = { label: string; onPress: () => void; style?: StyleProp<ViewStyle> };

/** Small brand pill button (e.g. "+ Add Bank"). */
export function PillButton({ label, onPress, style }: PillButtonProps) {
  return (
    <Pressable style={[s.fdPill, { alignSelf: "flex-start" }, style]} onPress={onPress}>
      <Txt style={s.fdPillTxt}>{label}</Txt>
    </Pressable>
  );
}
