import React, { useMemo, useState } from "react";
import { View, Pressable, StyleSheet, ScrollView } from "react-native";
import { ThemedText } from "./ThemedText";
import { GoldButton } from "./GoldButton";
import { BottomSheetModal } from "./BottomSheetModal";
import { Icon } from "./Icon";
import { colors } from "../theme/colors";

// A calendar drawn in the app's own gold/ivory language, NOT the stock OS
// date dialog — same reasoning as AppTabBar/FloatingHeader being custom
// rather than the default navigator chrome. It's also why there's no
// @react-native-community/datetimepicker dependency: the native picker can't
// be themed past its platform look, and everything below is plain RN, so it
// needs no native module and no rebuild.
//
// Values are exchanged as "YYYY-MM-DD" strings — the same wire format the
// backend's parseDate expects and the web DatePicker produces — so callers
// never handle Date objects or time zones.

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "YYYY-MM-DD" -> Date at local midnight, or null. Avoids `new Date(str)`,
 *  which parses a bare date as UTC and can land on the previous day. */
function parseISO(value?: string): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function toISO(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Human-facing label — "14 May 1990" reads unambiguously where "05/14" vs
 *  "14/05" does not. */
function pretty(d: Date) {
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}

export function GoldDatePicker({
  label,
  value,
  onChange,
  placeholder = "Select a date…",
  min,
  max,
}: {
  label?: string;
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Inclusive bounds, "YYYY-MM-DD". */
  min?: string;
  max?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseISO(value);
  const minDate = parseISO(min);
  const maxDate = parseISO(max);

  // The month on screen. Opens on the selected date, else today (clamped
  // into range so a max of "today" doesn't open on an all-disabled month).
  const [cursor, setCursor] = useState<Date>(() => {
    const base = selected ?? maxDate ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  // Tapping the "May 1990" title swaps the day grid for a year list —
  // essential for a date of birth, which is otherwise ~400 taps back.
  const [pickingYear, setPickingYear] = useState(false);

  function openSheet() {
    const base = selected ?? maxDate ?? new Date();
    setCursor(new Date(base.getFullYear(), base.getMonth(), 1));
    setPickingYear(false);
    setOpen(true);
  }

  function isDisabled(d: Date) {
    if (minDate && d < minDate) return true;
    if (maxDate && d > maxDate) return true;
    return false;
  }

  // Leading blanks pad the 1st to its weekday column.
  const cells = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const out: (Date | null)[] = Array.from({ length: firstWeekday }, () => null);
    for (let day = 1; day <= daysInMonth; day++) out.push(new Date(year, month, day));
    return out;
  }, [cursor]);

  const years = useMemo(() => {
    const upper = maxDate ? maxDate.getFullYear() : new Date().getFullYear();
    const lower = minDate ? minDate.getFullYear() : upper - 100;
    const out: number[] = [];
    for (let y = upper; y >= lower; y--) out.push(y);
    return out;
  }, [minDate, maxDate]);

  const today = new Date();

  return (
    <View style={styles.wrap}>
      {label ? (
        <ThemedText variant="label" color={colors.muted} style={styles.label}>
          {label}
        </ThemedText>
      ) : null}

      {/* Matches GoldTextInput's box exactly (height/radius/border/fill) so a
          date field sits in a form without looking like a button. */}
      <Pressable style={styles.field} onPress={openSheet}>
        <ThemedText variant="body" color={selected ? colors.ink : colors.muted}>
          {selected ? pretty(selected) : placeholder}
        </ThemedText>
        <Icon name="cal" size={18} color={colors.muted} />
      </Pressable>

      <BottomSheetModal visible={open} onClose={() => setOpen(false)} maxHeightPct={78}>
        <View style={styles.head}>
          <Pressable
            onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            hitSlop={12}
            style={styles.nav}
            disabled={pickingYear}
          >
            <ThemedText variant="h3" color={pickingYear ? colors.line : colors.muted}>
              ‹
            </ThemedText>
          </Pressable>

          <Pressable onPress={() => setPickingYear((v) => !v)} hitSlop={8}>
            <ThemedText variant="h3" color={colors.brandDeep}>
              {MONTHS[cursor.getMonth()]} {cursor.getFullYear()} {pickingYear ? "▴" : "▾"}
            </ThemedText>
          </Pressable>

          <Pressable
            onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            hitSlop={12}
            style={styles.nav}
            disabled={pickingYear}
          >
            <ThemedText variant="h3" color={pickingYear ? colors.line : colors.muted}>
              ›
            </ThemedText>
          </Pressable>
        </View>

        {pickingYear ? (
          <ScrollView style={{ maxHeight: 260 }} showsVerticalScrollIndicator={false}>
            <View style={styles.yearGrid}>
              {years.map((y) => {
                const active = y === cursor.getFullYear();
                return (
                  <Pressable
                    key={y}
                    style={[styles.year, active && styles.yearActive]}
                    onPress={() => {
                      setCursor(new Date(y, cursor.getMonth(), 1));
                      setPickingYear(false);
                    }}
                  >
                    <ThemedText variant="body" color={active ? colors.brandDeep : colors.ink}>
                      {y}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        ) : (
          <>
            <View style={styles.weekRow}>
              {WEEKDAYS.map((d, i) => (
                <ThemedText key={i} variant="label" color={colors.muted} style={styles.weekday}>
                  {d}
                </ThemedText>
              ))}
            </View>

            <View style={styles.grid}>
              {cells.map((d, i) => {
                if (!d) return <View key={`pad-${i}`} style={styles.cell} />;
                const disabled = isDisabled(d);
                const isSelected = !!selected && sameDay(d, selected);
                const isToday = sameDay(d, today);
                return (
                  <Pressable
                    key={toISO(d)}
                    disabled={disabled}
                    style={styles.cell}
                    onPress={() => {
                      onChange(toISO(d));
                      setOpen(false);
                    }}
                  >
                    <View style={[styles.day, isSelected && styles.daySelected, !isSelected && isToday && styles.dayToday]}>
                      <ThemedText
                        variant="body"
                        color={disabled ? colors.line : isSelected ? colors.bg : colors.ink}
                      >
                        {d.getDate()}
                      </ThemedText>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        <View style={styles.footer}>
          {value ? (
            <Pressable
              onPress={() => {
                onChange("");
                setOpen(false);
              }}
              hitSlop={8}
            >
              <ThemedText variant="label" color={colors.red}>
                Clear
              </ThemedText>
            </Pressable>
          ) : (
            <View />
          )}
          <View style={{ minWidth: 120 }}>
            <GoldButton title="Done" variant="outline" onPress={() => setOpen(false)} />
          </View>
        </View>
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { marginBottom: 6 },
  field: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 12,
  },
  nav: { paddingHorizontal: 10 },
  weekRow: { flexDirection: "row", marginBottom: 4 },
  weekday: { width: `${100 / 7}%`, textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  day: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  daySelected: { backgroundColor: colors.brandDeep },
  dayToday: { borderWidth: 1, borderColor: colors.brand },
  yearGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 4 },
  year: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  yearActive: { backgroundColor: colors.brandPale, borderColor: colors.brand },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 14,
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
});
