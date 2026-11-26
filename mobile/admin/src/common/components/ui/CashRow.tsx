import { View } from "react-native";
import { Txt } from "./Txt";
import { s } from "./cardStyles";

type CashRowProps = { k: string; v: string; color?: string; first?: boolean };

/** .cash-summary-row */
export function CashRow({ k, v, color, first }: CashRowProps) {
  return (
    <View style={[s.cashRow, !first && s.detailBorder]}>
      <Txt style={s.cashK}>{k}</Txt>
      <Txt style={[s.cashV, color ? { color } : null]}>{v}</Txt>
    </View>
  );
}
