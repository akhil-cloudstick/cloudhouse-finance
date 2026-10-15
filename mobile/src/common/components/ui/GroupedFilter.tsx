import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { Sheet } from "./Sheet";
import { SheetFooter } from "./SheetFooter";
import { PrimaryButton } from "./PrimaryButton";
import { SheetScrollView } from "./SheetScrollView";
import { DateField } from "./DateField";
import { FieldRow } from "./FieldRow";
import { ServerFlatList } from "./ServerFlatList";
import { SearchInput } from "./SearchInput";
import { useServerList } from "@/common/hooks/use-server-list";

/**
 * GroupedFilter — ONE filter control per table/list (mobile twin of web's
 * FilterPanel). A trigger pill ("Filters" + count badge) opens a sheet with a
 * scrolling row of group tabs (each with its selected count) and the active
 * group's list below it. "Reset all" is a text link in the header (only when
 * something is selected) and one "Show results" button closes the sheet; no
 * chips row, no standalone clear outside. Put the pill in the table header and
 * the Download buttons next to it. Filters apply live (onChange per tap).
 *
 * Usage:
 *   const [fv, setFv] = useState(emptyGroupedFilter());
 *   <GroupedFilter title="Filter report" value={fv} onChange={setFv} sections={[
 *     { kind: "async", key: "branch", label: "Branch", single: true,
 *       fetchPage: ({ q, limit, offset }) => listBranchesPage({ q, limit, offset })
 *         .then((r) => ({ items: r.items.map((b) => ({ value: String(b.id), label: b.name })), hasMore: r.hasMore })) },
 *     { kind: "static", key: "status", label: "Status", single: true, options: [{ value: "Active", label: "Active" }] },
 *     { kind: "date", key: "date", label: "Date", hideFrom?: false },
 *   ]} />
 *
 * Section kinds:
 *   static  { options, single? }  fixed list (checklist, or radio rows when single); searchable when long
 *   async   { fetchPage, deps?, single? } paginated + searchable list (server paged, 10/page)
 *   date    { hideFrom?, toLabel? } From / To date range (hideFrom: "as of" single date)
 *
 * Value: `{ options: { [key]: {value,label}[] }, dates: { [key]: {from?,to?} } }`
 * — selected options keep their labels so names can be shown without
 * refetching. Helpers: emptyGroupedFilter(), gfValues(v,key) -> string[],
 * gfFirst(v,key) -> string|undefined, gfDate(v,key), groupedFilterCount(v).
 * Props: `style` styles the trigger, `disabled` blocks opening.
 */
export type GFOption = { value: string; label: string };
export type GFSection =
  | { kind: "static"; key: string; label: string; options: GFOption[]; single?: boolean }
  | {
      kind: "async";
      key: string;
      label: string;
      single?: boolean;
      fetchPage: (p: { q?: string; limit: number; offset: number }) => Promise<{ items: GFOption[]; hasMore: boolean }>;
      /** Extra react-query key parts — pass values the fetch depends on (e.g. selected branches) so the list reloads. */
      deps?: unknown[];
    }
  | { kind: "date"; key: string; label: string; hideFrom?: boolean; toLabel?: string };

type PickSection = Exclude<GFSection, { kind: "date" }>;

export type GroupedFilterValue = {
  options: Record<string, GFOption[]>;
  dates: Record<string, { from?: string; to?: string }>;
};

export const emptyGroupedFilter = (): GroupedFilterValue => ({ options: {}, dates: {} });
export const gfValues = (v: GroupedFilterValue, key: string): string[] => (v.options[key] ?? []).map((o) => o.value);
export const gfFirst = (v: GroupedFilterValue, key: string): string | undefined => v.options[key]?.[0]?.value;
export const gfDate = (v: GroupedFilterValue, key: string): { from?: string; to?: string } => v.dates[key] ?? {};
export function groupedFilterCount(v: GroupedFilterValue): number {
  const o = Object.values(v.options).filter((a) => a.length > 0).length;
  const d = Object.values(v.dates).filter((x) => x.from || x.to).length;
  return o + d;
}

function toggle(cur: GFOption[], o: GFOption, single?: boolean): GFOption[] {
  const has = cur.some((c) => c.value === o.value);
  if (single) return has ? [] : [o];
  return has ? cur.filter((c) => c.value !== o.value) : [...cur, o];
}

type OptionRowProps = { checked: boolean; onPress: () => void; title: string; radio?: boolean };

/** One option inside a filter list — a flat row (no card / outline), a check (or radio) at the end. */
function OptionRow({ checked, onPress, title, radio }: OptionRowProps) {
  return (
    <Pressable onPress={onPress} style={st.opt} accessibilityRole={radio ? "radio" : "checkbox"} accessibilityState={{ checked }}>
      <Txt style={[st.optTxt, checked && st.optTxtOn]} numberOfLines={2}>{title}</Txt>
      {radio ? (
        <View style={[st.optRadio, checked && st.optRadioOn]}>{checked ? <View style={st.optDot} /> : null}</View>
      ) : (
        <View style={[st.optBox, checked && st.optBoxOn]}>{checked ? <PIcon name="check" color="#fff" size={13} strokeWidth={3} /> : null}</View>
      )}
    </Pressable>
  );
}

type AsyncPickerProps = { section: Extract<GFSection, { kind: "async" }>; selected: GFOption[]; onPick: (o: GFOption) => void };

function AsyncPicker({ section, selected, onPick }: AsyncPickerProps) {
  const list = useServerList<GFOption>({
    key: ["grouped-filter", section.key, ...(section.deps ?? [])],
    fetchPage: (p) => section.fetchPage({ q: p.q, limit: p.limit, offset: p.offset }),
  });
  return (
    <ServerFlatList
      list={list}
      items={list.items}
      inSheet
      gutter={16}
      keyOf={(o) => o.value}
      emptyText="Nothing found."
      header={<SearchInput value={list.search} onChangeText={list.setSearch} placeholder={`Search ${section.label.toLowerCase()}`} style={{ paddingHorizontal: 16, paddingBottom: 8 }} />}
      renderItem={(o) => <OptionRow radio={section.single} checked={selected.some((c) => c.value === o.value)} onPress={() => onPick(o)} title={o.label} />}
    />
  );
}

type StaticPickerProps = { section: Extract<GFSection, { kind: "static" }>; selected: GFOption[]; onPick: (o: GFOption) => void };

function StaticPicker({ section, selected, onPick }: StaticPickerProps) {
  const [q, setQ] = useState("");
  const long = section.options.length > 8;
  const needle = q.trim().toLowerCase();
  const rows = long && needle ? section.options.filter((o) => o.label.toLowerCase().includes(needle)) : section.options;
  return (
    <SheetScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }}>
      {long ? <SearchInput value={q} onChangeText={setQ} placeholder={`Search ${section.label.toLowerCase()}`} style={{ paddingHorizontal: 16, paddingBottom: 8 }} /> : null}
      <View style={st.list}>
        {rows.map((o) => (
          <OptionRow key={o.value} radio={section.single} checked={selected.some((c) => c.value === o.value)} onPress={() => onPick(o)} title={o.label} />
        ))}
        {rows.length === 0 ? <Txt style={st.empty}>Nothing found.</Txt> : null}
      </View>
    </SheetScrollView>
  );
}

// Cap on how far the filter sheet rises, as a % of screen height.
const SHEET_MAX_PCT = 65;

type GroupedFilterProps = {
  title?: string;
  sections: GFSection[];
  value: GroupedFilterValue;
  onChange: (next: GroupedFilterValue) => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
};

export function GroupedFilter({
  title = "Filters",
  sections,
  value,
  onChange,
  style,
  disabled,
}: GroupedFilterProps) {
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const { height: winH } = useWindowDimensions();
  const count = groupedFilterCount(value);
  const active = sections.find((s) => s.key === activeKey) ?? sections[0];

  // Hardware back, drag down, outside tap and the footer button all just close the sheet.
  const close = () => setOpen(false);
  const setOptions = (key: string, next: GFOption[]) => onChange({ ...value, options: { ...value.options, [key]: next } });
  const setDate = (key: string, patch: { from?: string; to?: string }) =>
    onChange({ ...value, dates: { ...value.dates, [key]: { ...gfDate(value, key), ...patch } } });
  const pick = (s: PickSection, o: GFOption) => setOptions(s.key, toggle(value.options[s.key] ?? [], o, s.single));
  const tabCount = (s: GFSection) => (s.kind === "date" ? (gfDate(value, s.key).from || gfDate(value, s.key).to ? 1 : 0) : (value.options[s.key] ?? []).length);

  return (
    <>
      <Pressable disabled={disabled} onPress={() => setOpen(true)} style={[st.pill, disabled && { opacity: 0.5 }, style]}>
        <Txt style={st.pillTxt}>Filters</Txt>
        <View style={st.count}>
          <Txt style={st.countTxt}>{count}</Txt>
        </View>
        <PIcon name="chevdown" color={C.brandDeep} />
      </Pressable>
      <Sheet
        visible={open}
        onClose={close}
        title={
          <View style={st.headRow}>
            <View style={st.headLeft}>
              <Txt style={st.headTitle} numberOfLines={1}>{title}</Txt>
              {count > 0 ? (
                <View style={st.count}>
                  <Txt style={st.countTxt}>{count}</Txt>
                </View>
              ) : null}
            </View>
            {count > 0 ? (
              <Pressable onPress={() => onChange(emptyGroupedFilter())} hitSlop={10}>
                <Txt style={st.reset}>Reset all</Txt>
              </Pressable>
            ) : null}
          </View>
        }
        maxHeightPct={SHEET_MAX_PCT}
        scroll={false}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={st.tabsScroll} contentContainerStyle={st.tabs}>
          {sections.map((s) => {
            const on = s.key === active?.key;
            const n = tabCount(s);
            return (
              <Pressable key={s.key} onPress={() => setActiveKey(s.key)} style={[st.tab, on && st.tabOn]}>
                <Txt style={[st.tabTxt, on && st.tabTxtOn]} numberOfLines={1}>{s.label}</Txt>
                {n > 0 ? (
                  <View style={[st.tabCount, on && st.tabCountOn]}>
                    <Txt style={[st.tabCountTxt, on && st.tabCountTxtOn]}>{n}</Txt>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={[st.body, { minHeight: Math.round((winH * SHEET_MAX_PCT * 0.46) / 100) }]}>
          {!active ? null : active.kind === "date" ? (
            <View style={st.dateWrap}>
              <FieldRow>
                {active.hideFrom ? null : <DateField label="From" value={gfDate(value, active.key).from} onChange={(v) => setDate(active.key, { from: v || undefined })} max={gfDate(value, active.key).to} clearable />}
                <DateField label={active.toLabel ?? (active.hideFrom ? "As of" : "To")} value={gfDate(value, active.key).to} onChange={(v) => setDate(active.key, { to: v || undefined })} min={gfDate(value, active.key).from} clearable />
              </FieldRow>
            </View>
          ) : active.kind === "static" ? (
            <StaticPicker key={active.key} section={active} selected={value.options[active.key] ?? []} onPick={(o) => pick(active, o)} />
          ) : (
            <AsyncPicker key={active.key} section={active} selected={value.options[active.key] ?? []} onPick={(o) => pick(active, o)} />
          )}
        </View>
        <SheetFooter>
          <PrimaryButton label={count > 0 ? `Show results · ${count} filter${count === 1 ? "" : "s"}` : "Show results"} onPress={close} />
        </SheetFooter>
      </Sheet>
    </>
  );
}

const st = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: C.brandFaint, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, alignSelf: "flex-start" },
  pillTxt: { fontSize: 12.5, fontWeight: "700", color: C.brandDeep },
  count: { backgroundColor: C.brandDeep, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, alignItems: "center", justifyContent: "center" },
  countTxt: { color: "#fff", fontSize: 10, fontWeight: "800" },
  headRow: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  headLeft: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  headTitle: { fontWeight: "700", fontSize: 15, flexShrink: 1 },
  reset: { fontSize: 13, fontWeight: "700", color: C.brand },
  tabsScroll: { flexGrow: 0, flexShrink: 0 },
  tabs: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12, gap: 8 },
  tab: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, backgroundColor: "#fff", borderWidth: 1, borderColor: C.line },
  tabOn: { backgroundColor: C.brandDeep, borderColor: C.brandDeep },
  tabTxt: { fontSize: 12.5, fontWeight: "700", color: C.muted },
  tabTxtOn: { color: "#fff" },
  tabCount: { backgroundColor: C.brandDeep, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
  tabCountOn: { backgroundColor: "#fff" },
  tabCountTxt: { color: "#fff", fontSize: 10, fontWeight: "800" },
  tabCountTxtOn: { color: C.brandDeep },
  body: { flexShrink: 1 },
  list: { paddingHorizontal: 16, paddingBottom: 12 },
  empty: { color: C.muted, textAlign: "center", paddingVertical: 20 },
  dateWrap: { paddingHorizontal: 16, paddingTop: 4 },
  opt: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.line },
  optTxt: { flex: 1, fontSize: 14, fontWeight: "500", color: C.ink },
  optTxtOn: { fontWeight: "700", color: C.ink },
  optBox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: C.line, alignItems: "center", justifyContent: "center" },
  optBoxOn: { backgroundColor: C.brandDeep, borderColor: C.brandDeep },
  optRadio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: C.line, alignItems: "center", justifyContent: "center" },
  optRadioOn: { borderColor: C.brandDeep },
  optDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.brandDeep },
});
