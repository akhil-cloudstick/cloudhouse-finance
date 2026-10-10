import { View, type StyleProp, type ViewStyle } from "react-native";
import { Txt } from "./Txt";
import { s } from "./cardStyles";

type SectionTitleProps = { children: string; flush?: boolean; style?: StyleProp<ViewStyle> };

/** .section-title (margin 20/18/10) — pass `flush` inside cards/sheets. */
export function SectionTitle({ children, flush, style }: SectionTitleProps) {
  return (
    <View style={[flush ? s.sectionFlush : s.section, style]}>
      <Txt style={s.sectionTxt}>{children.toUpperCase()}</Txt>
    </View>
  );
}
