import { View } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { s } from "./rowContext";

type PledgeItemProps = { icon: string; iconBg?: string; iconColor?: string; title: string; sub?: string; date?: string; first?: boolean };

/** .pledge-item — loan history timeline. */
export function PledgeItem({ icon, iconBg, iconColor, title, sub, date, first }: PledgeItemProps) {
  return (
    <View style={[s.pledge, !first && s.actBorder]}>
      <View style={[s.pledgeDot, iconBg ? { backgroundColor: iconBg } : null]}>
        <PIcon name={icon} color={iconColor ?? C.brandDeep} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={s.pledgeTitle}>{title}</Txt>
        {sub ? <Txt style={s.pledgeSub}>{sub}</Txt> : null}
      </View>
      {date ? <Txt style={s.pledgeDate}>{date}</Txt> : null}
    </View>
  );
}
