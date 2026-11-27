import { View, type StyleProp, type ViewStyle } from "react-native";
import { Txt } from "./Txt";
import { ChipTone, TONES, toneFor, s } from "./chipTones";

type StatusChipProps = { label: string; tone?: ChipTone; style?: StyleProp<ViewStyle> };

export function StatusChip({ label, tone, style }: StatusChipProps) {
  const t = TONES[tone ?? toneFor(label)];
  return (
    <View style={[s.chip, { backgroundColor: t.bg }, style]}>
      <Txt style={[s.chipTxt, { color: t.fg }]} numberOfLines={1}>
        {label.toUpperCase()}
      </Txt>
    </View>
  );
}
