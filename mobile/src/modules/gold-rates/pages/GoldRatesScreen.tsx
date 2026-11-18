import React, { useState } from "react";
import { LayoutAnimation, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  AccRow,
  C,
  PIcon,
  Txt,
  FabCorner,
  FlatHeader,
  GroupedFilter,
  Screen,
  SearchFilterRow,
  ServerFlatList,
  SummaryCard,
  emptyGroupedFilter,
  gfDate,
  gfValues,
  useShell,
  type AccDetail,
  type GFSection,
  type GroupedFilterValue,
} from "@/common/components/ui";
import { usePersistedState } from "@/common/hooks/use-persisted-state";
import { useServerList } from "@/common/hooks/use-server-list";
import { useRefetchOnFocus } from "@/common/hooks/use-refetch-on-focus";
import { useAuth } from "@/common/providers/AuthProvider";
import { NoAccess } from "@/common/components/NoAccess";
import { dmy, inr } from "@/common/utils/format";
import { latestGoldRate, listGoldRateDaysPage } from "@/modules/gold-rates/services/goldRateService";
import { getGoldRateSetByPage } from "@/modules/reports/services/reportsService";
import type { GoldRate } from "@/modules/gold-rates/types/gold-rate-types";

const timeOf = (iso: string) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";
};
/** A day's rate changes as a dropdown: one line ("3 changes") that opens a card per change — its time, who set it and
 * the 24K / 22K / 18K rates side by side — instead of a long run of text lines. */
function ChangesDropdown({ entries }: { entries: GoldRate[] }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: 12, overflow: "hidden", backgroundColor: C.card }}>
      <Pressable
        onPress={() => {
          LayoutAnimation.configureNext(LayoutAnimation.create(200, "easeInEaseOut", "opacity"));
          setOpen((o) => !o);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, gap: 8 }}
      >
        <Txt style={{ flex: 1, fontWeight: "700", fontSize: 13 }}>{entries.length} rate changes</Txt>
        <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}>
          <PIcon name="chevdown" color={C.muted} />
        </View>
      </Pressable>
      {open
        ? entries.map((e) => (
            <View key={e.id} style={{ borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.brandFaint, paddingHorizontal: 12, paddingVertical: 10 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6, gap: 8 }}>
                <Txt style={{ fontWeight: "700", fontSize: 12.5 }}>{timeOf(e.createdAt)}</Txt>
                <Txt numberOfLines={1} style={{ color: C.muted, fontSize: 12, flexShrink: 1 }}>{publisher(e)}</Txt>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {([["24K", e.k24], ["22K", e.k22], ["18K", e.k18]] as const).map(([lbl, v]) => (
                  <View key={lbl} style={{ flex: 1, backgroundColor: C.card, borderRadius: 8, borderWidth: 1, borderColor: C.line, paddingVertical: 6, alignItems: "center" }}>
                    <Txt style={{ color: C.muted, fontSize: 11 }}>{lbl}</Txt>
                    <Txt style={{ fontWeight: "700", fontSize: 13 }}>{inr(v)}</Txt>
                  </View>
                ))}
              </View>
            </View>
          ))
        : null}
    </View>
  );
}

const publisher = (r: GoldRate) => (r.setByDesignation ? `${r.setBy} · ${r.setByDesignation}` : r.setBy || "—");

// Gold Rates — mobile twin of the web Gold Rates page: today's published rates on top, then the rate history, one row
// per day (its newest rate) opening to 22K / 18K, who published it and — when the rate changed more than once that
// day — every change with its time. Search plus the web's filters: Set By and a Date range. Setting today's rate is
// the corner button (the Gold Rate pop-up's Set Rate form), so the history and its date filter live only here.
export default function GoldRatesScreen() {
  const { can } = useAuth();
  const shell = useShell();
  const canView = can("Gold_Rate_Management", "can_view_gold_rate_module");
  const canSetRate = can("Gold_Rate_Management", "can_create_gold_rate");

  const latest = useQuery({ queryKey: ["gold-rates", "latest"], queryFn: latestGoldRate, enabled: canView });
  const [fv, setFv] = usePersistedState<GroupedFilterValue>("gold-rates:filters", emptyGroupedFilter());
  const sections: GFSection[] = [
    {
      kind: "async",
      key: "setBy",
      label: "Set By",
      fetchPage: (p) => getGoldRateSetByPage(p).then((r) => ({ items: r.items.map((n) => ({ value: n, label: n })), hasMore: r.hasMore })),
    },
    { kind: "date", key: "date", label: "Date" },
  ];
  const setBy = gfValues(fv, "setBy");
  const { from, to } = gfDate(fv, "date");
  const list = useServerList<GoldRate, { setBy?: string[]; from?: string; to?: string }>({
    key: ["gold-rates", "days"],
    persistKey: "goldRates",
    enabled: canView,
    filters: { setBy: setBy.length ? setBy : undefined, from, to },
    fetchPage: (p) => listGoldRateDaysPage(p),
  });
  useRefetchOnFocus(latest.refetch);

  const header = <FlatHeader title="Gold Rates" subtitle="Published rates & full history" />;
  if (!canView) return <NoAccess header={header} />;

  const filtered = !!(list.search || setBy.length || from || to);
  const l = latest.data;

  return (
    <Screen header={header} floating={canSetRate ? <FabCorner onPress={shell.openGoldRate} icon="coin" label="Set today's rate" /> : undefined}>
      <ServerFlatList
        stickyHeader
        list={list}
        items={list.items}
        keyOf={(r) => String(r.id)}
        emptyText={filtered ? "No rates match your search or filters." : "No rates published yet."}
        header={
          <View>
            <SearchFilterRow
              value={list.search}
              onChangeText={list.setSearch}
              placeholder="Search date, rate or set by"
              filter={<GroupedFilter title="Filter rate history" sections={sections} value={fv} onChange={setFv} />}
              style={{ paddingTop: 12 }}
            />
            <View style={{ paddingTop: 2 }}>
              <SummaryCard
                title="Published rate · per gram"
                stats={[
                  { n: l?.k24 ? inr(Math.round(l.k24)) : "—", l: "24K · 999" },
                  { n: l?.k22 ? inr(Math.round(l.k22)) : "—", l: "22K · 916" },
                  { n: l?.k18 ? inr(Math.round(l.k18)) : "—", l: "18K · 750" },
                ]}
              />
            </View>
          </View>
        }
        renderItem={(r, i) => {
          const entries = r.entries && r.entries.length ? r.entries : [r];
          const changes = entries.length > 1;
          const details: AccDetail[] = [
            { k: "24K / g", v: inr(r.k24) },
            { k: "22K / g", v: inr(r.k22) },
            { k: "18K / g", v: inr(r.k18) },
            { k: "Published by", v: publisher(r) },
            // Every change that day, newest first — a dropdown, only when the rate was changed more than once.
            ...(changes ? [{ k: "Changes", v: <ChangesDropdown entries={entries} />, full: true }] : []),
          ];
          return (
            <AccRow
              cells={[
                { h: "Date", v: dmy(r.date || r.createdAt), flex: 1.2 },
                { h: "24K ₹/g", v: inr(r.k24), num: true },
                { h: "22K ₹/g", v: inr(r.k22), num: true },
                { h: "18K ₹/g", v: inr(r.k18), num: true },
                { h: "Changes", v: changes ? String(entries.length) : "" },
                { h: "Published By", v: publisher(r), flex: 1.4 },
              ]}
              defaultOpen={i === 0}
              name={dmy(r.date || r.createdAt)}
              sub={changes ? `${entries.length} changes · ${r.setBy || "—"}` : r.setBy || "—"}
              amount={`24K ${inr(r.k24)}`}
              details={details}
            />
          );
        }}
      />
    </Screen>
  );
}
