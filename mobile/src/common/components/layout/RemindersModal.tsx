import { useState } from "react";
import { View } from "react-native";
import { FilterChipRow, PrimaryButton, SearchInput, ServerFlatList, Sheet, openPage } from "@/common/components/ui";
import { useServerList } from "@/common/hooks/use-server-list";
import { listCalendarEventsPage } from "@/modules/reminders/services/reminderService";
import { useAuth } from "@/common/providers/AuthProvider";
import { useCanOpen } from "@/common/config/routePermissions";
import { addDaysISO, todayISO } from "@/common/utils/format";
import type { CalendarEvent } from "@/modules/reminders/types/reminder-types";
import { ReminderItem } from "./ReminderItem";
import { ReminderCreateSheet } from "./ReminderCreateSheet";

// ---------------------------------------------------------------------------
// Reminders modal (dashboard bell) — not in the prototype; built from its
// own pieces (.reminder-item + pills inside a rise-up sheet).
// ---------------------------------------------------------------------------
type RemScope = "Today" | "Upcoming" | "Overdue";
function rangeFor(scope: RemScope): { from: string; to: string } {
  const t = todayISO();
  if (scope === "Today") return { from: t, to: t };
  if (scope === "Upcoming") return { from: addDaysISO(t, 1), to: addDaysISO(t, 30) };
  return { from: addDaysISO(t, -90), to: addDaysISO(t, -1) };
}
type RemindersModalProps = { visible: boolean; onClose: () => void };

export function RemindersModal({ visible, onClose }: RemindersModalProps) {
  const [scope, setScope] = useState<RemScope>("Today");
  const [adding, setAdding] = useState(false);
  const canCreate = useAuth().can("Reminder_Management", "can_create_reminder");
  const canViewLoans = useCanOpen()("/loans");
  const range = rangeFor(scope);
  const list = useServerList<CalendarEvent, { from: string; to: string }>({
    key: ["reminders", "modal"],
    filters: range,
    fetchPage: (p) => listCalendarEventsPage(p),
    enabled: visible,
  });
  return (
    <>
      <Sheet
        visible={visible && !adding}
        onClose={onClose}
        title="Reminders"
        maxHeightPct={85}
        scroll={false}
        headExtra={
          <View style={{ paddingTop: 12 }}>
            <View style={{ paddingHorizontal: 16 }}>
              <FilterChipRow options={["Today", "Upcoming", "Overdue"] as const} value={scope} onChange={setScope} />
            </View>
            <SearchInput value={list.search} onChangeText={list.setSearch} placeholder="Search by customer name, ID, or loan number" style={{ paddingHorizontal: 16 }} />
          </View>
        }
      >
        <ServerFlatList
          list={list}
          items={list.items}
          inSheet
          gutter={16}
          emptyText={scope === "Today" ? "No reminders for today." : scope === "Upcoming" ? "No upcoming reminders." : "No overdue reminders."}
          keyOf={(e, i) => `${e.date}-${e.type}-${e.reminderId ?? e.loanId ?? i}`}
          renderItem={(e, i) => (
            <ReminderItem
              ev={e}
              first={i === 0}
              showDate={scope !== "Today"}
              onPress={
                e.loanId && canViewLoans
                  ? () => {
                      onClose();
                      openPage(`/loans/${e.loanId}`);
                    }
                  : undefined
              }
            />
          )}
          header={null}
        />
        {canCreate ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
            <PrimaryButton label="Add Reminder" onPress={() => setAdding(true)} />
          </View>
        ) : null}
      </Sheet>
      <ReminderCreateSheet visible={visible && adding} onClose={() => setAdding(false)} />
    </>
  );
}
