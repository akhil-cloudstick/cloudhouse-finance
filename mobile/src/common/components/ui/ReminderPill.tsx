import { View } from "react-native";
import { Txt } from "./Txt";
import { TONES, s } from "./chipTones";

type ReminderPillProps = { label: string; kind: "overdue" | "due" | "ptp" };

/** .reminder-type-pill */
export function ReminderPill({ label, kind }: ReminderPillProps) {
  const t = kind === "overdue" ? TONES.overdue : kind === "due" ? TONES.due : TONES.info;
  return (
    <View style={[s.remPill, { backgroundColor: t.bg }]}>
      <Txt style={[s.remPillTxt, { color: t.fg }]}>{label.toUpperCase()}</Txt>
    </View>
  );
}
