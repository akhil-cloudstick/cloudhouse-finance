import { Pressable, View } from "react-native";
import { ReminderPill, Txt } from "@/common/components/ui";
import { dmy } from "@/common/utils/format";
import type { CalendarEvent } from "@/modules/reminders/types/reminder-types";
import { s, reminderLabel, reminderKind } from "./shellModalsShared";

type ReminderItemProps = { ev: CalendarEvent; first?: boolean; showDate?: boolean; onPress?: () => void };

export function ReminderItem({ ev, first, showDate, onPress }: ReminderItemProps) {
  const who = [ev.customerName, ev.loanNumber].filter(Boolean).join(" — ") || ev.title;
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={[s.remItem, !first && s.remBorder]}>
      <ReminderPill label={reminderLabel(ev.type)} kind={reminderKind(ev.type)} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={s.remTitle} numberOfLines={1}>
          {who}
        </Txt>
        <Txt style={s.remSub} numberOfLines={2}>
          {showDate ? `${dmy(ev.date)} · ` : ""}
          {ev.detail || ev.title}
        </Txt>
      </View>
    </Pressable>
  );
}
