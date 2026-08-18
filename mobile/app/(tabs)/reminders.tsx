import React, { useMemo, useState } from "react";
import { RefreshControl, View, Pressable, StyleSheet, ScrollView } from "react-native";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { ScreenContainer } from "../../src/components/ScreenContainer";
import { BottomSheetModal } from "../../src/components/BottomSheetModal";
import { Card } from "../../src/components/Card";
import { ThemedText } from "../../src/components/ThemedText";
import { GoldTextInput } from "../../src/components/GoldTextInput";
import { GoldButton } from "../../src/components/GoldButton";
import { ChipSelect } from "../../src/components/ChipSelect";
import { colors, statusColors, StatusTone } from "../../src/theme/colors";
import { getCalendarEvents, createReminder } from "../../src/api/reminders";
import { listCustomers } from "../../src/api/customers";
import { CalendarEvent } from "../../src/types/reminder";
import { Customer } from "../../src/types/customer";
import { useDebouncedValue } from "../../src/hooks/useDebouncedValue";
import { ApiError } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { useRefetchOnFocus } from "../../src/hooks/useRefetchOnFocus";

function toneForType(type: CalendarEvent["type"]): StatusTone {
  if (type === "Overdue") return "red";
  if (type === "LoanDue" || type === "InterestDue") return "amber";
  if (type === "PromiseToPay") return "blue";
  return "muted";
}

const REMINDER_TYPES = ["Follow-Up", "Promise-to-Pay", "Custom"] as const;
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function toISODate(year: number, month: number, day: number): string {
  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

function fmtMonthYear(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

// "Add Reminder" modal — mirrors frontend/components/modals/ReminderModal.tsx's
// AddReminderModalContent: logs a manual Customer Follow-Up / Promise-to-Pay /
// Custom reminder (optionally tied to a loan) via POST /reminders
// (backend/internal/reminder/handler.go's reminderRequest).
function AddReminderModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [customerSearch, setCustomerSearch] = useState("");
  const debouncedCustomerSearch = useDebouncedValue(customerSearch);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loanId, setLoanId] = useState("");
  const [type, setType] = useState<(typeof REMINDER_TYPES)[number]>("Follow-Up");
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { employee } = useAuth();

  const customerResults = useQuery({
    queryKey: ["customers", "search-for-reminder", debouncedCustomerSearch],
    queryFn: () => listCustomers(debouncedCustomerSearch || undefined),
    enabled: visible && !customer && debouncedCustomerSearch.length > 0,
  });

  const create = useMutation({
    mutationFn: () => {
      if (!customer) throw new Error("Please select a customer.");
      if (!employee) throw new Error("You must be signed in to log a reminder.");
      return createReminder({
        customerId: customer.id,
        loanId: loanId ? Number(loanId) : null,
        type,
        dueDate,
        note: note.trim(),
        employeeId: employee.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reminders", "calendar"] });
      reset();
      onClose();
    },
    onError: (err) =>
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Failed to log reminder."),
  });

  function reset() {
    setCustomerSearch("");
    setCustomer(null);
    setLoanId("");
    setType("Follow-Up");
    setDueDate(new Date().toISOString().slice(0, 10));
    setNote("");
    setError(null);
  }

  return (
    <BottomSheetModal visible={visible} onClose={() => { reset(); onClose(); }} maxHeightPct={88}>
      <View style={styles.sheetHeader}>
        <ThemedText variant="h3">Add Reminder</ThemedText>
        <Pressable onPress={() => { reset(); onClose(); }}>
          <ThemedText variant="h3" color={colors.muted}>
            ×
          </ThemedText>
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
          {customer ? (
            <Card>
              <ThemedText variant="body">{customer.name} — {customer.code}</ThemedText>
              <Pressable onPress={() => setCustomer(null)}>
                <ThemedText variant="small" color={colors.goldDeep}>
                  Change customer
                </ThemedText>
              </Pressable>
            </Card>
          ) : (
            <>
              <GoldTextInput
                label="Customer *"
                placeholder="Search by name, code, or phone…"
                value={customerSearch}
                onChangeText={setCustomerSearch}
              />
              {customerResults.data?.slice(0, 6).map((c) => (
                <Pressable key={c.id} onPress={() => { setCustomer(c); setCustomerSearch(""); }}>
                  <Card style={{ paddingVertical: 10 }}>
                    <ThemedText variant="small">{c.name} — {c.code}</ThemedText>
                  </Card>
                </Pressable>
              ))}
            </>
          )}

          <ChipSelect label="Type *" options={REMINDER_TYPES} value={type} onChange={setType} />

          <GoldTextInput label="Due Date * (YYYY-MM-DD)" value={dueDate} onChangeText={setDueDate} />

          <GoldTextInput
            label="Loan Number (optional)"
            placeholder="Numeric loan id, if about a specific loan"
            keyboardType="numeric"
            value={loanId}
            onChangeText={(t) => setLoanId(t.replace(/\D/g, ""))}
          />

          <GoldTextInput
            label="Note"
            placeholder="e.g. Call about overdue interest"
            value={note}
            onChangeText={setNote}
          />

          {error ? (
            <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
              {error}
            </ThemedText>
          ) : null}

          <GoldButton
            title={create.isPending ? "Saving…" : "Add Reminder"}
            onPress={() => create.mutate()}
            loading={create.isPending}
            disabled={!customer || !dueDate}
          />
      </ScrollView>
    </BottomSheetModal>
  );
}

// A single day cell in the month grid — shows the day number plus one dot
// per event type present that day (capped at 4 dots so a busy day doesn't
// blow out the cell height), mirroring frontend/components/Calendar.tsx's
// event-per-day rendering but as compact dots (there's no room for full
// event-title chips at mobile cell width).
function DayCell({
  day,
  events,
  isToday,
  isSelected,
  onPress,
}: {
  day: number;
  events: CalendarEvent[];
  isToday: boolean;
  isSelected: boolean;
  onPress: () => void;
}) {
  const dotTypes = Array.from(new Set(events.map((e) => e.type))).slice(0, 4);
  return (
    <Pressable
      style={[styles.dayCell, isToday && styles.dayCellToday, isSelected && styles.dayCellSelected]}
      onPress={onPress}
    >
      <ThemedText
        variant="small"
        color={isSelected ? colors.ivory : isToday ? colors.goldDeep : colors.ink}
      >
        {day}
      </ThemedText>
      {dotTypes.length ? (
        <View style={styles.dotsRow}>
          {dotTypes.map((t) => (
            <View key={t} style={[styles.dot, { backgroundColor: statusColors(toneForType(t)).fg }]} />
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

// Month-grid Reminder Calendar — mirrors frontend/components/Calendar.tsx's
// month view (event dots per day, prev/next navigation, click-a-day detail
// panel) as plain RN Views/Pressables (no calendar library). Events are
// computed server-side per visible month via GET /reminders/calendar
// (manual reminders + live loan due/overdue/interest events) — no
// client-side date filtering beyond bucketing by day-of-month.
export default function RemindersScreen() {
  const [addVisible, setAddVisible] = useState(false);
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-based
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());

  const from = toISODate(year, month, 1);
  const to = toISODate(year, month, new Date(year, month + 1, 0).getDate());
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["reminders", "calendar", from, to],
    queryFn: () => getCalendarEvents(from, to),
  });

  useRefetchOnFocus(refetch);

  const events = data ?? [];

  const eventsByDay = useMemo(() => {
    const map = new Map<number, CalendarEvent[]>();
    for (const e of events) {
      const day = Number(e.date.slice(8, 10));
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(e);
    }
    return map;
  }, [events]);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow = new Date(year, month, 1).getDay();
  const cells: (number | null)[] = [
    ...new Array(startDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function goMonth(delta: number) {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setSelectedDay(null);
  }

  const dayEvents = selectedDay != null ? eventsByDay.get(selectedDay) ?? [] : [];

  return (
    <ScreenContainer>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      >
        <GoldButton title="+ Add Reminder" onPress={() => setAddVisible(true)} style={{ marginBottom: 16 }} />

        <View style={styles.monthNav}>
          <Pressable onPress={() => goMonth(-1)}>
            <ThemedText variant="h3" color={colors.goldDeep}>‹</ThemedText>
          </Pressable>
          <ThemedText variant="h3">{fmtMonthYear(year, month)}</ThemedText>
          <Pressable onPress={() => goMonth(1)}>
            <ThemedText variant="h3" color={colors.goldDeep}>›</ThemedText>
          </Pressable>
        </View>

        <View style={styles.weekRow}>
          {WEEKDAY_LABELS.map((d, i) => (
            <View key={i} style={styles.weekdayCell}>
              <ThemedText variant="label" color={colors.muted}>{d}</ThemedText>
            </View>
          ))}
        </View>

        {isLoading ? (
          <ThemedText color={colors.muted}>Loading…</ThemedText>
        ) : isError ? (
          <ThemedText color={colors.red}>Could not load reminders.</ThemedText>
        ) : (
          <View style={styles.grid}>
            {cells.map((day, i) =>
              day == null ? (
                <View key={i} style={styles.dayCell} />
              ) : (
                <DayCell
                  key={i}
                  day={day}
                  events={eventsByDay.get(day) ?? []}
                  isToday={isCurrentMonth && day === today.getDate()}
                  isSelected={selectedDay === day}
                  onPress={() => setSelectedDay(day)}
                />
              )
            )}
          </View>
        )}

        <ThemedText variant="h3" style={{ marginTop: 20, marginBottom: 8 }}>
          {selectedDay != null ? `${fmtMonthYear(year, month)} ${selectedDay}` : "Select a day"}
        </ThemedText>

        {selectedDay == null ? (
          <ThemedText color={colors.muted}>Tap a day above to see its events.</ThemedText>
        ) : dayEvents.length === 0 ? (
          <ThemedText color={colors.muted}>Nothing due this day.</ThemedText>
        ) : (
          dayEvents.map((item, idx) => {
            const tone = statusColors(toneForType(item.type));
            return (
              <Card key={`${item.date}-${item.type}-${item.loanId ?? item.reminderId ?? idx}`}>
                <ThemedText
                  variant="label"
                  style={{
                    alignSelf: "flex-start",
                    backgroundColor: tone.bg,
                    color: tone.fg,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: 6,
                    marginBottom: 6,
                  }}
                >
                  {item.type}
                </ThemedText>
                <ThemedText variant="h3">{item.title}</ThemedText>
                <ThemedText variant="small" color={colors.muted}>
                  {item.date} · {item.detail}
                </ThemedText>
              </Card>
            );
          })
        )}
      </ScrollView>
      <AddReminderModal visible={addVisible} onClose={() => setAddVisible(false)} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  monthNav: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  weekRow: {
    flexDirection: "row",
  },
  weekdayCell: {
    width: `${100 / 7}%`,
    alignItems: "center",
    paddingBottom: 4,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    marginBottom: 2,
  },
  dayCellToday: {
    borderWidth: 1,
    borderColor: colors.goldDeep,
  },
  dayCellSelected: {
    backgroundColor: colors.goldDeep,
  },
  dotsRow: {
    flexDirection: "row",
    gap: 2,
    marginTop: 2,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
});
