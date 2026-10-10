import { View, type StyleProp, type ViewStyle } from "react-native";
import { Txt } from "./Txt";
import { s } from "./rowContext";

type RepayItemProps = {
  label: string;
  value: string;
  labelColor?: string;
  valueColor?: string;
  first?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** .repay-item / .grm-history-item — label left, value right. */
export function RepayItem({
  label,
  value,
  labelColor,
  valueColor,
  first,
  style,
}: RepayItemProps) {
  return (
    <View style={[s.repay, !first && s.actBorder, style]}>
      <Txt style={[s.repayD, labelColor ? { color: labelColor } : null]}>{label}</Txt>
      <Txt style={[s.repayV, valueColor ? { color: valueColor } : null]}>{value}</Txt>
    </View>
  );
}
