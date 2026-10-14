import { Pressable, View } from "react-native";
import { AccBtn, ReminderPill, Txt } from "@/common/components/ui";
import { dmy } from "@/common/utils/format";
import type { CalendarEvent } from "@/modules/reminders/types/reminder-types";
import { s, reminderLabel, reminderKind } from "./shellModalsShared";

type ReminderItemProps = {
  ev: CalendarEvent;
  first?: boolean;
  showDate?: boolean;
  onPress?: () => void;
  // Row actions, offered only where given: mark a manual reminder Done, delete it, open its loan.
  onDone?: () => void;
  onDelete?: () => void;
  onOpenLoan?: () => void;
  busy?: boolean;
};

export function ReminderItem({ ev, first, showDate, onPress, onDone, onDelete, onOpenLoan, busy }: ReminderItemProps) {
  const who = [ev.customerName, ev.loanNumber].filter(Boolean).join(" — ") || ev.title;
  const hasActions = !!(onDone || onDelete || onOpenLoan);
  return (
    <View style={[s.remItem, !first && s.remBorder, hasActions ? { flexDirection: "column", alignItems: "stretch" } : null]}>
      <Pressable disabled={!onPress} onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <ReminderPill label={reminderLabel(ev.type)} kind={reminderKind(ev.type)} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt style={s.remTitle} numberOfLines={1}>
            {who}
          </Txt>
          <Txt style={s.remSub} numberOfLines={2}>
            {showDate ? `${dmy(ev.date)} · ` : ""}
            {ev.detail || ev.title}
            {ev.status === "Done" ? " · Done" : ""}
          </Txt>
        </View>
      </Pressable>
      {hasActions ? (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 8, opacity: busy ? 0.5 : 1 }}>
          {onOpenLoan ? <AccBtn label="Open loan" onPress={onOpenLoan} disabled={busy} /> : null}
          {onDone ? <AccBtn label="Done" onPress={onDone} disabled={busy} /> : null}
          {onDelete ? <AccBtn label="Delete" onPress={onDelete} disabled={busy} /> : null}
        </View>
      ) : null}
    </View>
  );
}
