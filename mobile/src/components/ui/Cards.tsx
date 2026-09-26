import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { C, Txt } from "./base";
import { PIcon } from "./PIcon";

/** .card — white rounded card with the page gutter. */
export function Card({ children, style, onPress }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  if (onPress)
    return (
      <Pressable style={[s.card, style]} onPress={onPress}>
        {children}
      </Pressable>
    );
  return <View style={[s.card, style]}>{children}</View>;
}

/** .section-title (margin 20/18/10) — pass `flush` inside cards/sheets. */
export function SectionTitle({ children, flush, style }: { children: string; flush?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[flush ? s.sectionFlush : s.section, style]}>
      <Txt style={s.sectionTxt}>{children.toUpperCase()}</Txt>
    </View>
  );
}

/** .summary-head + .summary-stats */
export function SummaryCard({ title, stats, onPress }: { title: string; stats: { n: string; l: string }[]; onPress?: () => void }) {
  return (
    <Card onPress={onPress}>
      <View style={s.summaryHead}>
        <Txt style={s.summaryT}>{title}</Txt>
        {onPress ? <PIcon name="chevron" color={C.muted} /> : null}
      </View>
      <View style={s.summaryStats}>
        {stats.map((st) => (
          <View key={st.l} style={{ flex: 1 }}>
            <Txt style={s.sstatN}>{st.n}</Txt>
            <Txt style={s.sstatL}>{st.l}</Txt>
          </View>
        ))}
      </View>
    </Card>
  );
}

/** .qa-item — quick action circle. */
export function QuickAction({ icon, label, tone, onPress }: { icon: string; label: string; tone: "loan" | "cust" | "pay"; onPress: () => void }) {
  const bg = tone === "loan" ? C.brandPale : tone === "cust" ? C.brandFaint : C.blueBg;
  const fg = tone === "loan" ? C.brandDeep : tone === "cust" ? C.brand : C.blue;
  return (
    <Pressable style={s.qaItem} onPress={onPress}>
      <View style={[s.qaCircle, { backgroundColor: bg }]}>
        <PIcon name={icon} color={fg} />
      </View>
      <Txt style={s.qaLabel}>{label}</Txt>
    </Pressable>
  );
}

/** .ld-field-grid — 2-col key/value grid. */
export function FieldGrid({ items, style }: { items: { k: string; v: React.ReactNode; color?: string }[]; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.grid, style]}>
      {items.map((it) => (
        <View key={it.k} style={s.gridCell}>
          <Txt style={s.gridK}>{it.k}</Txt>
          {typeof it.v === "string" || typeof it.v === "number" ? <Txt style={[s.gridV, it.color ? { color: it.color } : null]}>{it.v}</Txt> : it.v}
        </View>
      ))}
    </View>
  );
}

/** .ld-hero — name/sub/status + 3 amount columns. */
export function LdHero({ name, sub, status, amounts }: { name: string; sub: string; status?: React.ReactNode; amounts: { k: string; v: string; color?: string }[] }) {
  return (
    <View style={s.ldHero}>
      <View style={s.ldHeroTop}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt style={s.ldName}>{name}</Txt>
          <Txt style={s.ldSub}>{sub}</Txt>
        </View>
        {status}
      </View>
      <View style={s.ldAmtRow}>
        {amounts.map((a) => (
          <View key={a.k} style={{ flex: 1 }}>
            <Txt style={s.ldAmtK}>{a.k.toUpperCase()}</Txt>
            <Txt style={[s.ldAmtV, a.color ? { color: a.color } : null]}>{a.v}</Txt>
          </View>
        ))}
      </View>
    </View>
  );
}

/** .cust-detail-row */
export function DetailRow({ k, v, first }: { k: string; v: React.ReactNode; first?: boolean }) {
  return (
    <View style={[s.detailRow, !first && s.detailBorder]}>
      <Txt style={s.detailK}>{k}</Txt>
      <View style={{ flexShrink: 1, alignItems: "flex-end" }}>{typeof v === "string" || typeof v === "number" ? <Txt style={s.detailV}>{v}</Txt> : v}</View>
    </View>
  );
}

/** .cash-summary-row */
export function CashRow({ k, v, color, first }: { k: string; v: string; color?: string; first?: boolean }) {
  return (
    <View style={[s.cashRow, !first && s.detailBorder]}>
      <Txt style={s.cashK}>{k}</Txt>
      <Txt style={[s.cashV, color ? { color } : null]}>{v}</Txt>
    </View>
  );
}

/** .cash-closing-card */
export function ClosingCard({ k, v, formula }: { k: string; v: string; formula?: string }) {
  return (
    <View style={s.closing}>
      <Txt style={s.closingK}>{k.toUpperCase()}</Txt>
      <Txt style={s.closingV}>{v}</Txt>
      {formula ? <Txt style={s.closingF}>{formula}</Txt> : null}
    </View>
  );
}

/** .stepper — custody / auction progress. `current` is 0-based. */
export function Stepper({ steps, current, allDone }: { steps: string[]; current: number; allDone?: boolean }) {
  return (
    <View style={s.stepper}>
      {steps.map((label, i) => {
        const done = allDone || i < current;
        const cur = !allDone && i === current;
        return (
          <View key={label} style={s.step}>
            {i > 0 ? <View style={[s.stepLine, done && { backgroundColor: C.brandDeep }]} /> : null}
            <View style={[s.stepDot, done && { backgroundColor: C.brandDeep }, cur && { backgroundColor: C.accent }]}>
              {done ? <PIcon name="check" color="#fff" size={12} strokeWidth={3} /> : <Txt style={[s.stepDotTxt, cur && { color: "#fff" }]}>{i + 1}</Txt>}
            </View>
            <Txt style={[s.stepLabel, (done || cur) && { color: C.ink }]}>{label}</Txt>
          </View>
        );
      })}
    </View>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

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
}: {
  month: Date;
  selected?: string;
  onSelect: (iso: string) => void;
  dots?: Record<string, ("red" | "amber" | "blue")[]>;
  min?: string;
  max?: string;
  gutter?: number;
}) {
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

/** Dashboard "Cash flow · 7 days" area sparkline (prototype drawChart). */
export function Sparkline({ data, height = 60 }: { data: number[]; height?: number }) {
  const [w, setW] = useState(0);
  const path = useMemo(() => {
    if (!w || data.length < 2) return null;
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const p = 4;
    const step = (w - p * 2) / (data.length - 1);
    const pts = data.map((v, i) => [p + i * step, height - p - ((v - min) / range) * (height - p * 2)] as const);
    const line = pts.map((pt, i) => `${i ? "L" : "M"}${pt[0]},${pt[1]}`).join(" ");
    return { line, area: `${line} L${w - p},${height} L${p},${height} Z`, last: pts[pts.length - 1] };
  }, [w, data, height]);
  return (
    <View style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {path ? (
        <Svg width={w} height={height}>
          <Path d={path.area} fill="#6e142322" />
          <Path d={path.line} stroke={C.brandDeep} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" fill="none" />
          <Circle cx={path.last[0]} cy={path.last[1]} r={3.5} fill={C.brandDeep} />
        </Svg>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 18, padding: 16, marginHorizontal: 18, marginBottom: 12 },
  section: { marginTop: 20, marginHorizontal: 18, marginBottom: 10 },
  sectionFlush: { marginBottom: 8 },
  sectionTxt: { fontSize: 11, fontWeight: "700", color: C.muted, letterSpacing: 0.66 },
  summaryHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryT: { fontWeight: "700", fontSize: 13.5 },
  summaryStats: { flexDirection: "row", marginTop: 14 },
  sstatN: { fontSize: 16.5, fontWeight: "800" },
  sstatL: { fontSize: 11, color: C.muted, marginTop: 2 },
  qaItem: { flex: 1, alignItems: "center", gap: 9 },
  qaCircle: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  qaLabel: { fontSize: 11.5, fontWeight: "700", textAlign: "center", lineHeight: 14 },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: 12 },
  gridCell: { width: "50%", paddingRight: 16 },
  gridK: { fontSize: 10.5, color: C.muted, fontWeight: "600" },
  gridV: { fontSize: 13, fontWeight: "700", marginTop: 3 },
  ldHero: { margin: 14, marginHorizontal: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 18, padding: 16 },
  ldHeroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  ldName: { fontWeight: "700", fontSize: 15 },
  ldSub: { fontSize: 11.5, color: C.muted, marginTop: 2 },
  ldAmtRow: { flexDirection: "row", marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.line },
  ldAmtK: { fontSize: 10.5, color: C.muted, fontWeight: "600", letterSpacing: 0.4 },
  ldAmtV: { fontSize: 16, fontWeight: "800", marginTop: 3 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, gap: 12 },
  detailBorder: { borderTopWidth: 1, borderTopColor: C.line },
  detailK: { fontSize: 12, color: C.muted, fontWeight: "600" },
  detailV: { fontSize: 12.5, fontWeight: "700", textAlign: "right" },
  cashRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 9 },
  cashK: { fontSize: 13, color: C.muted, fontWeight: "600" },
  cashV: { fontSize: 13, fontWeight: "700" },
  closing: { backgroundColor: C.brandDeep, borderRadius: 18, padding: 16, marginHorizontal: 18, marginBottom: 14 },
  closingK: { color: "#fff", fontSize: 11, fontWeight: "700", letterSpacing: 0.44, opacity: 0.8 },
  closingV: { color: "#fff", fontSize: 24, fontWeight: "800", marginTop: 4 },
  closingF: { color: "#fff", fontSize: 11, opacity: 0.75, marginTop: 6 },
  stepper: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 6, paddingHorizontal: 2 },
  step: { flex: 1, alignItems: "center" },
  stepLine: { position: "absolute", top: 11, right: "50%", width: "100%", height: 2, backgroundColor: C.line },
  stepDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.line, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  stepDotTxt: { fontSize: 10, fontWeight: "800", color: C.muted },
  stepLabel: { fontSize: 9.5, fontWeight: "700", color: C.muted, textAlign: "center", lineHeight: 11.5 },
  calRow: { flexDirection: "row", justifyContent: "space-between" },
  calDow: { fontSize: 9.5, fontWeight: "700", color: C.muted, textAlign: "center" },
  calWrap: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  calDay: { borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: C.card, borderWidth: 1, borderColor: C.line, gap: 3 },
  calDaySel: { borderColor: C.brandDeep, backgroundColor: C.brandFaint },
  calDayTxt: { fontSize: 12, fontWeight: "600" },
  calDots: { flexDirection: "row", gap: 2 },
  calDot: { width: 5, height: 5, borderRadius: 2.5 },
});
