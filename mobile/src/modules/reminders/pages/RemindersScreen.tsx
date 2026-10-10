import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  C,
  FabCorner,
  FlatHeader,
  MonthGrid,
  PIcon,
  Buffering,
  EmptyText,
  Screen,
  SearchInput,
  SectionTitle,
  ServerFlatList,
  Txt,
  openPage,
} from "@/common/components/ui";
import { ReminderCreateSheet } from "@/common/components/layout/ReminderCreateSheet";
import { ReminderItem } from "@/common/components/layout/ReminderItem";
import { useServerList } from "@/common/hooks/use-server-list";
import { getCalendarEvents, listCalendarEventsPage } from "@/modules/reminders/services/reminderService";
import { dmy, todayISO } from "@/common/utils/format";
import type { CalendarEvent } from "@/modules/reminders/types/reminder-types";
import { useAuth } from "@/common/providers/AuthProvider";

// Reminders — prototype #header-reminders + #page-reminders: month header
// with prev/next, calendar grid with per-day dots (one bounded month query),
// the selected day's events paged from the server, and a server-side search
// (`q`) over the visible month. FAB opens Add Reminder for the selected day.

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// Day list is capped to roughly 8 rows; more load as it scrolls.
const EVENTS_MAX_HEIGHT = 460;
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dotFor(t: CalendarEvent["type"]): "red" | "amber" | "blue" {
  if (t === "Overdue") return "red";
  if (t === "LoanDue" || t === "InterestDue") return "amber";
  return "blue";
}

function dayTitle(iso: string) {
  const d = new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return `${DOW[d.getDay()]}, ${dmy(iso)}`;
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
      {/* The outer list only carries the calendar header; the day's events sit
          in a height-capped box below it that pages (10 at a time) as it scrolls. */}
      <ServerFlatList
        list={{
          isLoading: false,
          isRefreshing: list.isRefreshing,
          isFetchingNextPage: false,
          fetchNextPage: () => {},
          refetch: () => (monthEvents.refetch(), list.refetch()),
          error: undefined,
        }}
        items={[0]}
        header={header}
        emptyText=""
        keyOf={() => "events"}
        renderItem={() => (
          <View style={{ backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 18, maxHeight: EVENTS_MAX_HEIGHT, overflow: "hidden" }}>
            {list.items.length === 0 ? (
              list.isLoading ? (
                <Buffering block />
              ) : (
                <EmptyText>{searching ? "No reminders match your search." : "No reminders for this day."}</EmptyText>
              )
            ) : (
              <ScrollView
                nestedScrollEnabled
                showsVerticalScrollIndicator
                scrollEventThrottle={100}
                contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 4, opacity: list.isLoading ? 0.45 : 1 }}
                onScroll={({ nativeEvent: n }) => {
                  if (n.layoutMeasurement.height + n.contentOffset.y >= n.contentSize.height - 80) list.fetchNextPage();
                }}
              >
                {list.items.map((e, i) => (
                  <ReminderItem
                    key={`${e.date}-${e.type}-${e.reminderId ?? e.loanId ?? i}`}
                    ev={e}
                    first={i === 0}
                    showDate={searching}
                    onPress={e.loanId && canViewLoans ? () => openPage(`/loans/${e.loanId}`) : undefined}
                  />
                ))}
                {list.isFetchingNextPage ? <Buffering /> : null}
              </ScrollView>
            )}
          </View>
        )}
      />
      <ReminderCreateSheet visible={adding} onClose={() => setAdding(false)} defaultDate={selected} />
    </Screen>
  );
}

const navBtn = { width: 34, height: 34, borderRadius: 10, backgroundColor: C.brandFaint, alignItems: "center" as const, justifyContent: "center" as const };
