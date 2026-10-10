import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { s } from "./chipTones";

type FiltersBarProps = {
  count?: number;
  summary?: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  showCount?: boolean;
};

// ---- .fd-b-pill (Filters (n) trigger) + summary text ----------------------
export function FiltersBar({
  count,
  summary,
  onPress,
  style,
  showCount = true,
}: FiltersBarProps) {
  return (
    <View style={[s.fdTrigger, style]}>
      <Pressable style={s.fdPill} onPress={onPress}>
        <Txt style={s.fdPillTxt}>Filters</Txt>
        {showCount ? (
          <View style={s.fdCount}>
            <Txt style={s.fdCountTxt}>{count ?? 0}</Txt>
          </View>
        ) : null}
        <PIcon name="chevdown" color={C.brandDeep} />
      </Pressable>
      {summary ? <Txt style={s.fdSummary}>{summary}</Txt> : null}
    </View>
  );
}
