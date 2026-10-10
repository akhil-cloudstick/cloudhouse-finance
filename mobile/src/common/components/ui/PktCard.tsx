import { Pressable, View } from "react-native";
import { Txt } from "./Txt";
import { StatusChip } from "./StatusChip";
import { s } from "./rowContext";

type PktCardProps = {
  code: string;
  status: string;
  loan: string;
  customer: string;
  items: number;
  weight: string;
  location: string;
  onPress: () => void;
};

/** .pkt-card — two-row packet card, opens a detail sheet. */
export function PktCard({
  code,
  status,
  loan,
  customer,
  items,
  weight,
  location,
  onPress,
}: PktCardProps) {
  return (
    <Pressable style={s.pkt} onPress={onPress}>
      <View style={s.pktRow1}>
        <Txt style={s.pktId}>{code}</Txt>
        <StatusChip label={status} />
      </View>
      <View style={s.pktRow2}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt style={s.pktLoan} numberOfLines={1}>
            {loan}
          </Txt>
          <Txt style={s.pktSub} numberOfLines={1}>
            {customer}
          </Txt>
        </View>
        <View>
          <Txt style={s.pktMeta}>
            <Txt style={s.pktMetaB}>{items}</Txt> {items === 1 ? "ornament" : "ornaments"} · <Txt style={s.pktMetaB}>{weight}</Txt>
          </Txt>
          <Txt style={s.pktMeta}>{location}</Txt>
        </View>
      </View>
    </Pressable>
  );
}
