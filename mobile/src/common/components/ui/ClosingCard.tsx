import { View } from "react-native";
import { Txt } from "./Txt";
import { s } from "./cardStyles";

type ClosingCardProps = { k: string; v: string; formula?: string };

/** .cash-closing-card */
export function ClosingCard({ k, v, formula }: ClosingCardProps) {
  return (
    <View style={s.closing}>
      <Txt style={s.closingK}>{k.toUpperCase()}</Txt>
      <Txt style={s.closingV}>{v}</Txt>
      {formula ? <Txt style={s.closingF}>{formula}</Txt> : null}
    </View>
  );
}
