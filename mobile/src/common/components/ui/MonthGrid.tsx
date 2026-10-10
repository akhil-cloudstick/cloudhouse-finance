import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { s } from "./cardStyles";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
type MonthGridProps = {
  month: Date;
  selected?: string;
  onSelect: (iso: string) => void;
  dots?: Record<string, ("red" | "amber" | "blue")[]>;
  min?: string;
  max?: string;
  gutter?: number;
};

/** .cal-grid — month grid with optional per-day dots (reminders). Leading /
 * trailing days from neighbouring months are shown muted. */
export function MonthGrid({
  month,
  selected,
  onSelect,
  dots,
  min,
  max,
  gutter = 18,
}: MonthGridProps) {
  const cells = useMemo(() => {
    const y = month.getFullYear();
    const m = month.getMonth();
    const first = new Date(y, m, 1);
    const start = new Date(y, m, 1 - first.getDay());
    const days = new Date(y, m + 1, 0).getDate();
    const total = Math.ceil((first.getDay() + days) / 7) * 7;
    return Array.from({ length: total }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [month]);
  const [w, setW] = useState(0);
  const cell = w ? (w - 6 * 4) / 7 : 0;
  return (
    <View style={{ paddingHorizontal: gutter }}>
      <View style={[s.calRow, { marginBottom: 6 }]}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <Txt key={i} style={[s.calDow, { width: cell || undefined, flex: cell ? undefined : 1 }]}>
            {d}
          </Txt>
        ))}
      </View>
      <View style={s.calWrap} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {cell
          ? cells.map((d) => {
              const key = iso(d);
              const muted = d.getMonth() !== month.getMonth();
              const disabled = (min && key < min) || (max && key > max);
              const sel = key === selected;
              const ds = dots?.[key];
              return (
                <Pressable
                  key={key}
                  disabled={!!disabled || muted}
                  onPress={() => onSelect(key)}
                  style={[s.calDay, { width: cell, height: cell }, muted && { opacity: 0.35 }, disabled && { opacity: 0.35 }, sel && s.calDaySel]}
                >
                  <Txt style={[s.calDayTxt, sel && { color: C.brandDeep }]}>{d.getDate()}</Txt>
                  {ds && ds.length ? (
                    <View style={s.calDots}>
                      {ds.slice(0, 3).map((c, i) => (
                        <View key={i} style={[s.calDot, { backgroundColor: c === "red" ? C.red : c === "amber" ? C.amber : C.blue }]} />
                      ))}
                    </View>
                  ) : null}
                </Pressable>
              );
            })
          : null}
      </View>
    </View>
  );
}
