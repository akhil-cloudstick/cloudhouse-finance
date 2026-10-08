import React, { useState } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { C, Txt } from "./base";
import { PIcon } from "./PIcon";
import { Sheet } from "./Sheet";
import { AccBtn } from "./Rows";
import { CheckItem, DateField, FieldRow } from "./Form";
import { SearchInput, ServerFlatList } from "./ListKit";
import { useServerList } from "../../hooks/useServerList";
import { dmy } from "../../lib/format";

/**
 * GroupedFilter — ONE filter control per table/list (mobile twin of web's
 * FilterPanel). A trigger pill ("Filters" + count badge) opens a sheet listing
 * every section with its currently selected NAMES; tapping a section opens its
 * picker, a "Reset all" button lives inside the sheet (no chips row, no
 * standalone clear outside). Put the pill in the table header and the
 * Export / Download buttons next to it.
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
 *   static  { options, single? }  fixed list, single or multi select
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

function dateText(d: { from?: string; to?: string }, hideFrom?: boolean): string {
  if (hideFrom) return d.to ? dmy(d.to) : "";
  if (d.from && d.to) return `${dmy(d.from)} – ${dmy(d.to)}`;
  if (d.from) return `From ${dmy(d.from)}`;
  if (d.to) return `Until ${dmy(d.to)}`;
  return "";
}

function summaryOf(s: GFSection, v: GroupedFilterValue): string {
  if (s.kind === "date") return dateText(gfDate(v, s.key), s.hideFrom);
  return (v.options[s.key] ?? []).map((o) => o.label).join(", ");
}

function toggle(cur: GFOption[], o: GFOption, single?: boolean): GFOption[] {
  const has = cur.some((c) => c.value === o.value);
  if (single) return has ? [] : [o];
  return has ? cur.filter((c) => c.value !== o.value) : [...cur, o];
}

function AsyncPicker({ section, selected, onPick }: { section: Extract<GFSection, { kind: "async" }>; selected: GFOption[]; onPick: (o: GFOption) => void }) {
  const list = useServerList<GFOption>({
    key: ["grouped-filter", section.key, ...(section.deps ?? [])],
    fetchPage: (p) => section.fetchPage({ q: p.q, limit: p.limit, offset: p.offset }),
  });
  return (
    <ServerFlatList
      list={list}
      items={list.items}
      inSheet
      keyOf={(o) => o.value}
      emptyText="Nothing found."
      header={<SearchInput value={list.search} onChangeText={list.setSearch} placeholder={`Search ${section.label.toLowerCase()}`} style={{ paddingHorizontal: 16 }} />}
      renderItem={(o) => <CheckItem checked={selected.some((c) => c.value === o.value)} onPress={() => onPick(o)} title={o.label} />}
    />
  );
}

export function GroupedFilter({
  title = "Filters",
  sections,
  value,
  onChange,
  style,
  disabled,
}: {
  title?: string;
  sections: GFSection[];
  value: GroupedFilterValue;
  onChange: (next: GroupedFilterValue) => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const count = groupedFilterCount(value);
  const active = sections.find((s): s is PickSection => s.key === activeKey && s.kind !== "date");

  const close = () => {
    setOpen(false);
    setActiveKey(null);
  };
  const setOptions = (key: string, next: GFOption[]) => onChange({ ...value, options: { ...value.options, [key]: next } });
  const setDate = (key: string, patch: { from?: string; to?: string }) =>
    onChange({ ...value, dates: { ...value.dates, [key]: { ...gfDate(value, key), ...patch } } });
  const pick = (s: PickSection, o: GFOption) => {
    setOptions(s.key, toggle(value.options[s.key] ?? [], o, s.single));
    if (s.single) setActiveKey(null);
  };

  return (
    <>
      <Pressable disabled={disabled} onPress={() => setOpen(true)} style={[st.pill, disabled && { opacity: 0.5 }, style]}>
        <Txt style={st.pillTxt}>Filters</Txt>
        <View style={st.count}>
          <Txt style={st.countTxt}>{count}</Txt>
        </View>
        <PIcon name="chevdown" color={C.brandDeep} />
      </Pressable>
      <Sheet visible={open} onClose={close} title={active ? active.label : title} maxHeightPct={80} scroll={!active}>
        {active ? (
          <>
            {active.kind === "static" ? (
              <View style={st.list}>
                {active.options.map((o) => (
                  <CheckItem key={o.value} checked={(value.options[active.key] ?? []).some((c) => c.value === o.value)} onPress={() => pick(active, o)} title={o.label} />
                ))}
              </View>
            ) : (
              <AsyncPicker section={active} selected={value.options[active.key] ?? []} onPick={(o) => pick(active, o)} />
            )}
            <View style={st.foot}>
              <AccBtn label={active.single ? "Back" : "Done"} onPress={() => setActiveKey(null)} />
            </View>
          </>
        ) : (
          <View style={st.list}>
            {sections.map((s) =>
              s.kind === "date" ? (
                <View key={s.key} style={st.dateWrap}>
                  <Txt style={st.secLabel}>{s.label}</Txt>
                  <FieldRow>
                    {s.hideFrom ? null : <DateField label="From" value={gfDate(value, s.key).from} onChange={(v) => setDate(s.key, { from: v || undefined })} max={gfDate(value, s.key).to} clearable />}
                    <DateField label={s.toLabel ?? (s.hideFrom ? "As of" : "To")} value={gfDate(value, s.key).to} onChange={(v) => setDate(s.key, { to: v || undefined })} min={gfDate(value, s.key).from} clearable />
                  </FieldRow>
                </View>
              ) : (
                <Pressable key={s.key} style={st.row} onPress={() => setActiveKey(s.key)}>
                  <View style={{ flex: 1 }}>
                    <Txt style={st.secLabel}>{s.label}</Txt>
                    <Txt style={[st.secVal, !summaryOf(s, value) && { color: C.muted, fontWeight: "500" }]} numberOfLines={2}>
                      {summaryOf(s, value) || (s.single ? "All" : "All")}
                    </Txt>
                  </View>
                  <PIcon name="chevright" color={C.muted} />
                </Pressable>
              )
            )}
            <View style={st.foot}>
              <AccBtn label="Reset all" disabled={count === 0} onPress={() => onChange(emptyGroupedFilter())} />
            </View>
          </View>
        )}
      </Sheet>
    </>
  );
}

const st = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: C.brandFaint, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, alignSelf: "flex-start" },
  pillTxt: { fontSize: 12.5, fontWeight: "700", color: C.brandDeep },
  count: { backgroundColor: C.brandDeep, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, alignItems: "center", justifyContent: "center" },
  countTxt: { color: "#fff", fontSize: 10, fontWeight: "800" },
  list: { paddingHorizontal: 16, paddingTop: 4, gap: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line },
  secLabel: { fontSize: 11.5, fontWeight: "700", color: C.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  secVal: { fontSize: 14, fontWeight: "700", color: C.ink, marginTop: 2 },
  dateWrap: { paddingVertical: 12, gap: 6 },
  foot: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
});
