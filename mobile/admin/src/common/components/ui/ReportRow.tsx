import { Pressable } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { s } from "./rowContext";

type ReportRowProps = { title: string; onPress: () => void };

export function ReportRow({ title, onPress }: ReportRowProps) {
  return (
    <Pressable style={s.reportRow} onPress={onPress}>
      <Txt style={s.reportTitle}>{title}</Txt>
      <PIcon name="chevright" color={C.muted} />
    </Pressable>
  );
}
