import React, { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  C,
  FabCorner,
  FlatHeader,
  MonthGrid,
  PIcon,
  Screen,
  SearchInput,
  SectionTitle,
  ServerFlatList,
  Txt,
  openPage,
} from "../../src/components/ui";
import { ReminderCreateSheet, ReminderItem } from "../../src/components/staff/ShellModals";
import { useServerList } from "../../src/hooks/useServerList";
import { getCalendarEvents, listCalendarEventsPage } from "../../src/api/reminders";
import { todayISO } from "../../src/lib/format";
import type { CalendarEvent } from "../../src/types/reminder";
import { useAuth } from "../../src/auth/AuthContext";

// Reminders — prototype #header-reminders + #page-reminders: month header
// with prev/next, calendar grid with per-day dots (one bounded month query),
// the selected day's events paged from the server, and a server-side search
// (`q`) over the visible month. FAB opens Add Reminder for the selected day.

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dotFor(t: CalendarEvent["type"]): "red" | "amber" | "blue" {
  if (t === "Overdue") return "red";
  if (t === "LoanDue" || t === "InterestDue") return "amber";
  return "blue";
}

function dayTitle(iso: string) {
  const d = new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return `${DOW[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
}

export default function RemindersScreen() {
  const today = todayISO();
  const [month, setMonth] = useState(() => new Date(+today.slice(0, 4), +today.slice(5, 7) - 1, 1));
  const [selected, setSelected] = useState(today);
  const [adding, setAdding] = useState(false);
  const { can } = useAuth();
  const canCreate = can("Reminder_Management", "can_create_reminder");
  const canViewLoans = can("Loan_Management", "can_view_loan_module");

  const y = month.getFullYear();
  const m = month.getMonth();
  const from = isoOf(y, m, 1);
  const to = isoOf(y, m, new Date(y, m + 1, 0).getDate());

  // Dots for the visible month only (bounded window).
  const monthEvents = useQuery({ queryKey: ["reminders", "calendar", from, to], queryFn: () => getCalendarEvents(from, to) });
  const dots = useMemo(() => {
    const map: Record<string, ("red" | "amber" | "blue")[]> = {};
    for (const e of monthEvents.data ?? []) {
      const k = e.date.slice(0, 10);
      const c = dotFor(e.type);
      const arr = (map[k] ??= []);
      if (!arr.includes(c)) arr.push(c);
    }
    return map;
  }, [monthEvents.data]);

  // Day list — or, while searching, matches across the visible month.
  const [searchText, setSearchText] = useState("");
  const searching = searchText.trim().length > 0;
  const range = searching ? { from, to } : { from: selected, to: selected };
  const list = useServerList<CalendarEvent, { from: string; to: string }>({
    key: ["reminders", "day-list"],
    filters: range,
    fetchPage: (p) => listCalendarEventsPage(p),
  });
  const onSearch = (v: string) => {
    setSearchText(v);
    list.setSearch(v);
  };

  function goMonth(delta: number) {
    const d = new Date(y, m + delta, 1);
    setMonth(d);
    const first = isoOf(d.getFullYear(), d.getMonth(), 1);
    setSelected(today.slice(0, 7) === first.slice(0, 7) ? today : first);
  }

  const last = list.items.length - 1;
  const header = (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, paddingHorizontal: 18 }}>
        <Txt style={{ fontWeight: "700", fontSize: 14 }}>
          {MONTHS[m]} {y}
        </Txt>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable onPress={() => goMonth(-1)} hitSlop={4} accessibilityLabel="Previous month" style={navBtn}>
            <PIcon name="back" color={C.brandDeep} />
          </Pressable>
          <Pressable onPress={() => goMonth(1)} hitSlop={4} accessibilityLabel="Next month" style={[navBtn, { transform: [{ scaleX: -1 }] }]}>
            <PIcon name="back" color={C.brandDeep} />
          </Pressable>
        </View>
      </View>
      <MonthGrid month={month} selected={selected} onSelect={setSelected} dots={dots} />
      <SearchInput value={searchText} onChangeText={onSearch} placeholder="Search reminders by customer name, ID or loan number" style={{ paddingTop: 14, paddingBottom: 0 }} />
      <SectionTitle>{searching ? `Matches in ${MONTHS[m]} ${y}` : dayTitle(selected)}</SectionTitle>
    </View>
  );

  return (
    <Screen
      header={<FlatHeader title="Reminders" subtitle="Follow-ups & promise-to-pay" />}
      floating={canCreate ? <FabCorner onPress={() => setAdding(true)} label="Add reminder" /> : undefined}
    >
      <ServerFlatList
        list={{ ...list, refetch: () => (monthEvents.refetch(), list.refetch()) }}
        items={list.items}
        header={header}
        emptyText={searching ? "No reminders match your search." : "No reminders for this day."}
        keyOf={(e, i) => `${e.date}-${e.type}-${e.reminderId ?? e.loanId ?? i}`}
        renderItem={(e, i) => (
          <View
            style={{
              backgroundColor: C.card,
              borderColor: C.line,
              borderLeftWidth: 1,
              borderRightWidth: 1,
              borderTopWidth: i === 0 ? 1 : 0,
              borderBottomWidth: i === last ? 1 : 0,
              borderTopLeftRadius: i === 0 ? 18 : 0,
              borderTopRightRadius: i === 0 ? 18 : 0,
              borderBottomLeftRadius: i === last ? 18 : 0,
              borderBottomRightRadius: i === last ? 18 : 0,
              paddingHorizontal: 16,
              paddingTop: i === 0 ? 4 : 0,
              paddingBottom: i === last ? 4 : 0,
            }}
          >
            <ReminderItem
              ev={e}
              first={i === 0}
              showDate={searching}
              onPress={e.loanId && canViewLoans ? () => openPage(`/loans/${e.loanId}`) : undefined}
            />
          </View>
        )}
      />
      <ReminderCreateSheet visible={adding} onClose={() => setAdding(false)} defaultDate={selected} />
    </Screen>
  );
}

const navBtn = { width: 34, height: 34, borderRadius: 10, backgroundColor: C.brandFaint, alignItems: "center" as const, justifyContent: "center" as const };
