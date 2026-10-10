import { View } from "react-native";
import { Txt } from "./Txt";
import { s } from "./rowContext";

type MoveItemProps = { title: string; sub?: string; date?: string; first?: boolean };

/** .move-item — packet movement history. */
export function MoveItem({ title, sub, date, first }: MoveItemProps) {
  return (
    <View style={[s.move, !first && s.actBorder]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={s.moveT}>{title}</Txt>
        {sub ? <Txt style={s.moveS}>{sub}</Txt> : null}
      </View>
      {date ? <Txt style={s.moveD}>{date}</Txt> : null}
    </View>
  );
}
