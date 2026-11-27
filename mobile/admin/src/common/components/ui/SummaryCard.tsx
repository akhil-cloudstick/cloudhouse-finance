import { View } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { Card } from "./Card";
import { s } from "./cardStyles";

type SummaryCardProps = { title: string; stats: { n: string; l: string }[]; onPress?: () => void };

/** .summary-head + .summary-stats */
export function SummaryCard({ title, stats, onPress }: SummaryCardProps) {
  return (
    <Card onPress={onPress}>
      <View style={s.summaryHead}>
        <Txt style={s.summaryT}>{title}</Txt>
        {onPress ? <PIcon name="chevron" color={C.muted} /> : null}
      </View>
      <View style={s.summaryStats}>
        {stats.map((st) => (
          <View key={st.l} style={{ flex: 1 }}>
            <Txt style={s.sstatN}>{st.n}</Txt>
            <Txt style={s.sstatL}>{st.l}</Txt>
          </View>
        ))}
      </View>
    </Card>
  );
}
