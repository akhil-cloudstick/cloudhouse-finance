import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  C,
  FabCorner,
  FlatHeader,
  MonthGrid,
  PIcon,
  Buffering,
  EmptyText,
  FilterChipRow,
  Screen,
  SearchInput,
  SectionTitle,
  ServerFlatList,
  Sheet,
  Txt,
  openPage,
  toast,
} from "@/common/components/ui";
import { ReminderCreateSheet } from "@/common/components/layout/ReminderCreateSheet";
import { ReminderItem } from "@/common/components/layout/ReminderItem";
import { useServerList } from "@/common/hooks/use-server-list";
import { completeReminder, deleteReminder, getCalendarEvents, listCalendarEventsPage } from "@/modules/reminders/services/reminderService";
import { userMessage } from "@/common/services/apiErrors";
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

// Same segments as the web day panel: a coloured count circle per group, tap one to list its events.
const GROUPS: { key: string; label: string; fg: string; bg: string; types: CalendarEvent["type"][] }[] = [
  { key: "overdue", label: "Overdue", fg: C.red, bg: C.redBg, types: ["Overdue", "PersonalLoanOverdue", "InvestmentPayoutOverdue"] },
  { key: "due", label: "Loan due", fg: C.amber, bg: C.amberBg, types: ["LoanDue", "PersonalLoanDue"] },
  { key: "auction", label: "Auction", fg: C.amber, bg: C.amberBg, types: ["AuctionScheduled"] },
  { key: "interest", label: "Interest", fg: C.green, bg: C.greenBg, types: ["InterestDue"] },
  { key: "investment", label: "Investment payout", fg: C.green, bg: C.greenBg, types: ["InvestmentPayoutDue", "InvestmentPayoutOverdue"] },
  { key: "followup", label: "Follow-up", fg: C.blue, bg: C.blueBg, types: ["FollowUp"] },
  { key: "promise", label: "Promise to pay", fg: C.blue, bg: C.blueBg, types: ["PromiseToPay"] },
];
const GROUPED_TYPES = GROUPS.flatMap((g) => g.types);

function dotFor(t: CalendarEvent["type"]): "red" | "amber" | "blue" | "green" {
  // Same colours as the web calendar chips: overdue red, due and auction amber, interest green, follow-up / promise blue.
  if (t === "Overdue" || t === "PersonalLoanOverdue" || t === "InvestmentPayoutOverdue") return "red";
  if (t === "LoanDue" || t === "PersonalLoanDue" || t === "AuctionScheduled") return "amber";
  if (t === "InterestDue" || t === "InvestmentPayoutDue") return "green";
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
  const [picking, setPicking] = useState(false);
  const { can } = useAuth();
  const canCreate = can("Reminder_Management", "can_create_reminder");
  const canViewLoans = can("Loan_Management", "can_view_loan_module");
  const canViewPersonalLoans = can("Personal_Loan_Management", "can_view_personal_loan_module");
  const canViewInvestments = can("Investment_Management", "can_view_investment_module");
  const canUpdateReminder = can("Reminder_Management", "can_update_reminder");
  const canDeleteReminder = can("Reminder_Management", "can_delete_reminder");
  const qc = useQueryClient();
  // Mark a manual reminder Done / delete it — the calendar and the day list reload.
  const reload = () => qc.invalidateQueries({ queryKey: ["reminders"] });
  const done = useMutation({ mutationFn: (id: number) => completeReminder(id), onSuccess: reload, onError: (e) => toast.error("Couldn't mark it done", userMessage(e, "Try again.")) });
  const remove = useMutation({ mutationFn: (id: number) => deleteReminder(id), onSuccess: reload, onError: (e) => toast.error("Couldn't delete it", userMessage(e, "Try again.")) });

  const y = month.getFullYear();
  const m = month.getMonth();
  const from = isoOf(y, m, 1);
  const to = isoOf(y, m, new Date(y, m + 1, 0).getDate());

  // Dots for the visible month only (bounded window).
  const monthEvents = useQuery({ queryKey: ["reminders", "calendar", from, to], queryFn: () => getCalendarEvents(from, to) });
  const dots = useMemo(() => {
    const map: Record<string, ("red" | "amber" | "blue" | "green")[]> = {};
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
    enabled: searching, // the day view reads the month already loaded; the list is only shown while searching
  });
  // Day view (not searching): the selected day's events from the month already loaded, split into the groups above.
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const dayEvents = useMemo(() => (monthEvents.data ?? []).filter((e) => e.date.slice(0, 10) === selected), [monthEvents.data, selected]);
  const groupsOfDay = useMemo(
    () =>
      [
        ...GROUPS.map((g) => ({ ...g, items: dayEvents.filter((e) => g.types.includes(e.type)) })),
        { key: "other", label: "Other", fg: C.blue, bg: C.blueBg, types: [], items: dayEvents.filter((e) => !GROUPED_TYPES.includes(e.type)) },
      ].filter((g) => g.items.length > 0),
    [dayEvents]
  );
  const shownItems = searching ? list.items : (groupsOfDay.find((g) => g.key === openGroup)?.items ?? []);
  const selectDay = (iso: string) => {
    setSelected(iso);
    setOpenGroup(null);
  };
  const onSearch = (v: string) => {
    setSearchText(v);
    list.setSearch(v);
  };

  // Jump to any month: used by the prev/next buttons and by the month / year picker.
  function goTo(year: number, monthIndex: number) {
    const d = new Date(year, monthIndex, 1);
    setMonth(d);
    setOpenGroup(null);
    const first = isoOf(d.getFullYear(), d.getMonth(), 1);
    setSelected(today.slice(0, 7) === first.slice(0, 7) ? today : first);
  }

  function goMonth(delta: number) {
    goTo(y, m + delta);
  }

  const todayYear = +today.slice(0, 4);
  const yearOptions = Array.from(new Set([...Array.from({ length: 21 }, (_, i) => todayYear - 10 + i), y]))
    .sort((a, b) => a - b)
    .map(String);

  const header = (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, paddingHorizontal: 18 }}>
        <Pressable onPress={() => setPicking(true)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Choose month and year">
          <Txt style={{ fontWeight: "700", fontSize: 14 }}>
            {MONTHS[m]} {y} ▾
          </Txt>
        </Pressable>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          {selected !== today || today.slice(0, 7) !== isoOf(y, m, 1).slice(0, 7) ? (
            <Pressable
              onPress={() => {
                goTo(todayYear, +today.slice(5, 7) - 1);
                selectDay(today);
              }}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Go to today"
              style={{ paddingHorizontal: 12, height: 34, borderRadius: 11, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, alignItems: "center", justifyContent: "center" }}
            >
              <Txt style={{ fontSize: 12.5, fontWeight: "700", color: C.brandDeep }}>Today</Txt>
            </Pressable>
          ) : null}
          <Pressable onPress={() => goMonth(-1)} hitSlop={4} accessibilityLabel="Previous month" style={navBtn}>
            <PIcon name="back" color={C.brandDeep} />
          </Pressable>
          <Pressable onPress={() => goMonth(1)} hitSlop={4} accessibilityLabel="Next month" style={[navBtn, { transform: [{ scaleX: -1 }] }]}>
            <PIcon name="back" color={C.brandDeep} />
          </Pressable>
        </View>
      </View>
      <MonthGrid month={month} selected={selected} onSelect={selectDay} dots={dots} />
      <SearchInput value={searchText} onChangeText={onSearch} placeholder="Search reminders by customer name, ID or loan number" style={{ paddingTop: 14, paddingBottom: 0 }} />
      <SectionTitle>{searching ? `Matches in ${MONTHS[m]} ${y}` : dayTitle(selected)}</SectionTitle>
      {!searching && groupsOfDay.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: 18, paddingBottom: 12 }}>
          {groupsOfDay.map((g) => {
            const on = openGroup === g.key;
            return (
              <Pressable
                key={g.key}
                onPress={() => setOpenGroup(on ? null : g.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${g.label}: ${g.items.length}`}
                style={{ width: 64, alignItems: "center", gap: 4 }}
              >
                <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: g.bg, borderWidth: 2, borderColor: on ? g.fg : "transparent" }}>
                  <Txt style={{ fontWeight: "700", fontSize: 14, color: g.fg }}>{g.items.length}</Txt>
                </View>
                <Txt style={{ fontSize: 10.5, color: on ? C.ink : C.muted, textAlign: "center", lineHeight: 13 }}>{g.label}</Txt>
              </Pressable>
            );
          })}
        </View>
      ) : null}
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
            {shownItems.length === 0 ? (
              (searching ? list.isLoading : monthEvents.isLoading) ? (
                <Buffering block />
              ) : (
                <EmptyText>
                  {searching ? "No reminders match your search." : dayEvents.length === 0 ? "No reminders for this day." : "Select a circle to see its reminders."}
                </EmptyText>
              )
            ) : (
              <ScrollView
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
                scrollEventThrottle={100}
                contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 4, opacity: list.isLoading ? 0.45 : 1 }}
                onScroll={({ nativeEvent: n }) => {
                  if (n.layoutMeasurement.height + n.contentOffset.y >= n.contentSize.height - 80) list.fetchNextPage();
                }}
              >
                {shownItems.map((e, i) => (
                  <ReminderItem
                    key={`${e.date}-${e.type}-${e.reminderId ?? e.loanId ?? i}`}
                    ev={e}
                    first={i === 0}
                    showDate={searching}
                    onPress={
                      e.investmentId != null && canViewInvestments
                        ? () => openPage(`/investments/${e.investmentId}`)
                        : e.loanId && canViewLoans
                        ? () => openPage(`/loans/${e.loanId}`)
                        : e.personalLoanId != null && canViewPersonalLoans
                          ? () => openPage(`/personal-loans/${e.personalLoanId}`)
                          : undefined
                    }
                    onOpenLoan={
                      e.personalLoanId != null && canViewPersonalLoans
                        ? () => openPage(`/personal-loans/${e.personalLoanId}`)
                        : undefined
                    }
                    onDone={e.reminderId != null && canUpdateReminder && e.status !== "Done" ? () => done.mutate(e.reminderId!) : undefined}
                    onDelete={e.reminderId != null && canDeleteReminder ? () => remove.mutate(e.reminderId!) : undefined}
                    busy={(done.isPending && done.variables === e.reminderId) || (remove.isPending && remove.variables === e.reminderId)}
                  />
                ))}
                {list.isFetchingNextPage ? <Buffering /> : null}
              </ScrollView>
            )}
          </View>
        )}
      />
      <ReminderCreateSheet visible={adding} onClose={() => setAdding(false)} defaultDate={selected} />
      <Sheet visible={picking} onClose={() => setPicking(false)} title="Go to month">
        <SectionTitle>Month</SectionTitle>
        <FilterChipRow
          options={MONTHS}
          value={MONTHS[m]}
          onChange={(name) => { goTo(y, MONTHS.indexOf(name)); setPicking(false); }}
        />
        <SectionTitle>Year</SectionTitle>
        <FilterChipRow
          options={yearOptions}
          value={String(y)}
          onChange={(year) => { goTo(+year, m); setPicking(false); }}
        />
      </Sheet>
    </Screen>
  );
}

const navBtn = { width: 34, height: 34, borderRadius: 10, backgroundColor: C.brandFaint, alignItems: "center" as const, justifyContent: "center" as const };
