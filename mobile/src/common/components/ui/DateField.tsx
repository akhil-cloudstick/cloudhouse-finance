import { useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, View } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { Sheet } from "./Sheet";
import { MonthGrid } from "./MonthGrid";
import { SheetNestedScrollView } from "./SheetNestedScrollView";
import { Field } from "./Field";
import { s, isoToPretty } from "./formHelpers";
import { PrimaryButton } from "./PrimaryButton";

type DateFieldProps = {
  label?: string;
  value?: string;
  onChange: (v: string) => void;
  placeholder?: string;
  min?: string;
  max?: string;
  clearable?: boolean;
};

export function DateField({
  label,
  value,
  onChange,
  placeholder = "DD-MM-YYYY",
  min,
  max,
  clearable,
}: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const [pickYear, setPickYear] = useState(false);
  const init = value ? new Date(+value.slice(0, 4), +value.slice(5, 7) - 1, 1) : new Date();
  const [cursor, setCursor] = useState(new Date(init.getFullYear(), init.getMonth(), 1));
  const thisYear = new Date().getFullYear();
  const minYear = min ? +min.slice(0, 4) : thisYear - 100;
  const maxYear = max ? +max.slice(0, 4) : thisYear + 20;
  const years = useMemo(() => Array.from({ length: maxYear - minYear + 1 }, (_, i) => maxYear - i), [minYear, maxYear]);
  const yearScroll = useRef<ScrollView>(null);
  return (
    <Field label={label}>
      <Pressable
        onPress={() => {
          const base = value ? new Date(+value.slice(0, 4), +value.slice(5, 7) - 1, 1) : new Date();
          setCursor(new Date(base.getFullYear(), base.getMonth(), 1));
          setPickYear(false);
          Keyboard.dismiss();
          setOpen(true);
        }}
        style={[s.input, s.dateBtn]}
      >
        <Txt style={{ fontSize: 13.5, color: value ? C.ink : C.muted }}>{value ? isoToPretty(value) : placeholder}</Txt>
        <PIcon name="calendar" color={C.muted} size={15} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={label ?? "Select date"} maxHeightPct={70}>
        <View style={s.calHead}>
          <Pressable style={s.calNav} onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
            <PIcon name="back" color={C.brandDeep} />
          </Pressable>
          <Pressable style={s.calTitleBtn} onPress={() => setPickYear((y) => !y)} hitSlop={6} accessibilityLabel="Choose year">
            <Txt style={s.calTitle}>
              {cursor.toLocaleString("en-IN", { month: "long" })} {cursor.getFullYear()}
            </Txt>
            <View style={pickYear ? { transform: [{ rotate: "180deg" }] } : null}>
              <PIcon name="chevdown" color={C.brandDeep} />
            </View>
          </Pressable>
          <Pressable style={[s.calNav, { transform: [{ scaleX: -1 }] }]} onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
            <PIcon name="back" color={C.brandDeep} />
          </Pressable>
        </View>
        {pickYear ? (
          <SheetNestedScrollView
            ref={yearScroll}
            style={{ maxHeight: 280 }}
            onLayout={() => {
              const row = Math.floor(years.indexOf(cursor.getFullYear()) / 4);
              yearScroll.current?.scrollTo({ y: Math.max(0, row * 48 - 96), animated: false });
            }}
          >
            <View style={s.yearGrid}>
              {years.map((y) => {
                const sel = y === cursor.getFullYear();
                return (
                  <Pressable
                    key={y}
                    style={[s.yearCell, sel && s.yearCellSel]}
                    onPress={() => {
                      setCursor(new Date(y, cursor.getMonth(), 1));
                      setPickYear(false);
                    }}
                  >
                    <Txt style={[s.yearTxt, sel && { color: "#fff" }]}>{y}</Txt>
                  </Pressable>
                );
              })}
            </View>
          </SheetNestedScrollView>
        ) : null}
        {pickYear ? null : (
        <MonthGrid
          month={cursor}
          selected={value}
          min={min}
          max={max}
          gutter={0}
          onSelect={(iso) => {
            onChange(iso);
            setOpen(false);
          }}
        />
        )}
        {clearable && value ? (
          <PrimaryButton
            label="Clear date"
            variant="outline"
            style={{ marginTop: 14 }}
            onPress={() => {
              onChange("");
              setOpen(false);
            }}
          />
        ) : null}
      </Sheet>
    </Field>
  );
}
