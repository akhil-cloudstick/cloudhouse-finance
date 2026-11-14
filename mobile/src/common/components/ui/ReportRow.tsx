import { Pressable } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { s } from "./rowContext";

// onPrint adds the web tile's quick Print button (prints the report with its default range).
type ReportRowProps = { title: string; onPress: () => void; onPrint?: () => void; printBusy?: boolean };

export function ReportRow({ title, onPress, onPrint, printBusy }: ReportRowProps) {
  return (
    <Pressable style={s.reportRow} onPress={onPress}>
      <Txt style={s.reportTitle}>{title}</Txt>
      {onPrint ? (
        <Pressable onPress={onPrint} disabled={printBusy} hitSlop={8} accessibilityLabel={`Print ${title}`} style={{ marginRight: 12, opacity: printBusy ? 0.5 : 1 }}>
          <Txt style={{ fontSize: 12, fontWeight: "700", color: C.brandDeep }}>{printBusy ? "Printing…" : "Print"}</Txt>
        </Pressable>
      ) : null}
      <PIcon name="chevright" color={C.muted} />
    </Pressable>
  );
}
