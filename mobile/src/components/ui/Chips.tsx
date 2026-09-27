import React, { useEffect, useState } from "react";
import { Animated, Easing, Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { C, Txt } from "./base";
import { PIcon } from "./PIcon";

// ---- .status-chip ---------------------------------------------------------
export type ChipTone = "active" | "overdue" | "due" | "closed" | "info";

const TONES: Record<ChipTone, { fg: string; bg: string }> = {
  active: { fg: C.green, bg: C.greenBg },
  overdue: { fg: C.red, bg: C.redBg },
  due: { fg: C.amber, bg: C.amberBg },
  closed: { fg: C.muted, bg: C.brandFaint },
  info: { fg: C.blue, bg: C.blueBg },
};

/** Maps any backend status string onto the prototype's four chip styles. */
export function toneFor(status?: string | null): ChipTone {
  const x = (status ?? "").toLowerCase();
  if (!x) return "closed";
  if (/(overdue|default|reject|auction eligible|full|void|missed|fail|loss|expired|cash out)/.test(x)) return "overdue";
  if (/(pending|due|draft|renewed|bank pledged|await|at risk|partial|request|scheduled|notice)/.test(x)) return "due";
  if (/(closed|released|matured|inactive|retired|withdrawn|settled|surplus|returned|cancel)/.test(x)) return "closed";
  if (/(active|approved|disbursed|stored|done|paid|verified|safe|cash in|complete|generated|success|conducted)/.test(x)) return "active";
  return "closed";
}

export function StatusChip({ label, tone, style }: { label: string; tone?: ChipTone; style?: StyleProp<ViewStyle> }) {
  const t = TONES[tone ?? toneFor(label)];
  return (
    <View style={[s.chip, { backgroundColor: t.bg }, style]}>
      <Txt style={[s.chipTxt, { color: t.fg }]} numberOfLines={1}>
        {label.toUpperCase()}
      </Txt>
    </View>
  );
}

/** .kyc-badge */
export function KycBadge({ verified, label }: { verified: boolean; label?: string }) {
  return (
    <View style={[s.kyc, { backgroundColor: verified ? C.greenBg : C.amberBg }]}>
      <Txt style={[s.kycTxt, { color: verified ? C.green : C.amber }]}>{label ?? (verified ? "Verified" : "Pending")}</Txt>
    </View>
  );
}

/** .reminder-type-pill */
export function ReminderPill({ label, kind }: { label: string; kind: "overdue" | "due" | "ptp" }) {
  const t = kind === "overdue" ? TONES.overdue : kind === "due" ? TONES.due : TONES.info;
  return (
    <View style={[s.remPill, { backgroundColor: t.bg }]}>
      <Txt style={[s.remPillTxt, { color: t.fg }]}>{label.toUpperCase()}</Txt>
    </View>
  );
}

// ---- .filter-chip / .filter-chip-row --------------------------------------
export function FilterChip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.fchip, active && s.fchipActive]}>
      <Txt style={[s.fchipTxt, active && s.fchipTxtActive]}>{label}</Txt>
    </Pressable>
  );
}

export function FilterChipRow<T extends string>({
  options,
  value,
  onChange,
  labels,
  style,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labels?: Partial<Record<T, string>>;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.fchipRow, style]} keyboardShouldPersistTaps="handled">
      {options.map((o) => (
        <FilterChip key={o} label={labels?.[o] ?? o} active={o === value} onPress={() => onChange(o)} />
      ))}
    </ScrollView>
  );
}

// ---- .chip-toggle ---------------------------------------------------------
export function ChipToggle<T extends string>({
  options,
  value,
  onChange,
  labels,
  wrap,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labels?: Partial<Record<T, string>>;
  wrap?: boolean;
}) {
  return (
    <View style={[s.toggle, wrap && { flexWrap: "wrap" }]}>
      {options.map((o) => {
        const active = o === value;
        return (
          <Pressable key={o} onPress={() => onChange(o)} style={[s.toggleItem, wrap && { minWidth: "45%" }, active && s.toggleItemActive]}>
            <Txt style={[s.toggleTxt, active && s.toggleTxtActive]} numberOfLines={1}>
              {labels?.[o] ?? o}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---- .cust-tabs (sticky pill tabs) ----------------------------------------
export function PillTabs<T extends string>({
  tabs,
  value,
  onChange,
  labels,
  style,
  inSheet,
}: {
  tabs: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labels?: Partial<Record<T, string>>;
  style?: StyleProp<ViewStyle>;
  /** Inside a modal body: static, no gutter/border (pl-detail tabs). */
  inSheet?: boolean;
}) {
  // Two or three tabs split the width equally with a sliding highlight;
  // longer sets keep the horizontally scrolling pills.
  if (tabs.length <= 3) return <SegmentTabs tabs={tabs} value={value} onChange={onChange} labels={labels} style={style} inSheet={inSheet} />;
  return (
    <View style={[inSheet ? s.pillTabsSheet : s.pillTabs, style]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.pillTabsInner, inSheet && { paddingHorizontal: 0 }]}>
        {tabs.map((t) => {
          const active = t === value;
          return (
            <Pressable key={t} onPress={() => onChange(t)} style={[s.pillTab, active && s.pillTabActive]}>
              <Txt style={[s.pillTabTxt, active && s.pillTabTxtActive]}>{labels?.[t] ?? t}</Txt>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Equal-width segmented tabs; the active highlight glides between them. */
function SegmentTabs<T extends string>({
  tabs,
  value,
  onChange,
  labels,
  style,
  inSheet,
}: {
  tabs: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labels?: Partial<Record<T, string>>;
  style?: StyleProp<ViewStyle>;
  inSheet?: boolean;
}) {
  const [w, setW] = useState(0);
  const idx = Math.max(0, tabs.indexOf(value));
  const [x] = useState(() => new Animated.Value(idx));
  useEffect(() => {
    Animated.timing(x, { toValue: idx, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [idx, x]);
  const seg = w > 0 ? (w - 6) / tabs.length : 0;
  return (
    <View style={[inSheet ? s.pillTabsSheet : s.pillTabs, style]}>
      <View style={[s.segTrack, inSheet && { marginHorizontal: 0 }]} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {seg > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[s.segThumb, { width: seg, transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, seg] }) }] }]}
          />
        ) : null}
        {tabs.map((t) => {
          const active = t === value;
          return (
            <Pressable key={t} onPress={() => onChange(t)} style={s.segItem} accessibilityRole="tab" accessibilityState={{ selected: active }}>
              <Txt style={[s.pillTabTxt, active && s.pillTabTxtActive]} numberOfLines={1}>
                {labels?.[t] ?? t}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ---- .subtab-row ----------------------------------------------------------
export function SubTabs<T extends string>({ tabs, value, onChange, labels }: { tabs: readonly T[]; value: T; onChange: (v: T) => void; labels?: Partial<Record<T, string>> }) {
  // Equal widths so every option stays on screen, however long its label.
  return (
    <View style={s.subRow}>
      {tabs.map((t) => {
        const active = t === value;
        return (
          <Pressable key={t} onPress={() => onChange(t)} style={[s.subTab, { flex: 1, alignItems: "center" }, active && s.subTabActive]}>
            <Txt style={[s.subTabTxt, active && s.subTabTxtActive]} numberOfLines={1} adjustsFontSizeToFit>
              {labels?.[t] ?? t}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---- .grm-tabs (equal-width tabs inside a modal) --------------------------
export function GrmTabs<T extends string>({ tabs, value, onChange, labels }: { tabs: readonly T[]; value: T; onChange: (v: T) => void; labels?: Partial<Record<T, string>> }) {
  return (
    <View style={s.grmTabs}>
      {tabs.map((t) => {
        const active = t === value;
        return (
          <Pressable key={t} onPress={() => onChange(t)} style={[s.grmTab, active && s.grmTabActive]}>
            <Txt style={[s.grmTabTxt, active && { color: "#fff" }]}>{labels?.[t] ?? t}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---- .fd-b-pill (Filters (n) trigger) + summary text ----------------------
export function FiltersBar({
  count,
  summary,
  onPress,
  style,
  showCount = true,
}: {
  count?: number;
  summary?: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  showCount?: boolean;
}) {
  return (
    <View style={[s.fdTrigger, style]}>
      <Pressable style={s.fdPill} onPress={onPress}>
        <Txt style={s.fdPillTxt}>Filters</Txt>
        {showCount ? (
          <View style={s.fdCount}>
            <Txt style={s.fdCountTxt}>{count ?? 0}</Txt>
          </View>
        ) : null}
        <PIcon name="chevdown" color={C.brandDeep} />
      </Pressable>
      {summary ? <Txt style={s.fdSummary}>{summary}</Txt> : null}
    </View>
  );
}

/** Small brand pill button (e.g. "+ Add Bank"). */
export function PillButton({ label, onPress, style }: { label: string; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable style={[s.fdPill, { alignSelf: "flex-start" }, style]} onPress={onPress}>
      <Txt style={s.fdPillTxt}>{label}</Txt>
    </Pressable>
  );
}

const s = StyleSheet.create({
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: "flex-start" },
  chipTxt: { fontSize: 10, fontWeight: "700" },
  kyc: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, alignSelf: "flex-start" },
  kycTxt: { fontSize: 10, fontWeight: "700" },
  remPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, flexShrink: 0 },
  remPillTxt: { fontSize: 10, fontWeight: "700" },

  fchipRow: { flexDirection: "row", gap: 7, marginBottom: 10 },
  fchip: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, backgroundColor: C.brandFaint },
  fchipActive: { backgroundColor: C.brandDeep },
  fchipTxt: { fontSize: 11.5, fontWeight: "600", color: C.brandDeep },
  fchipTxtActive: { color: "#fff" },

  toggle: { flexDirection: "row", backgroundColor: C.brandFaint, borderRadius: 11, padding: 3 },
  toggleItem: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 8 },
  toggleItemActive: { backgroundColor: C.brandDeep },
  toggleTxt: { fontSize: 12.5, fontWeight: "700", color: C.muted },
  toggleTxtActive: { color: "#fff" },

  pillTabs: { backgroundColor: C.bg, borderBottomWidth: 1, borderBottomColor: C.line },
  pillTabsSheet: { paddingBottom: 12 },
  pillTabsInner: { flexDirection: "row", gap: 6, paddingVertical: 10, paddingHorizontal: 18 },
  pillTab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: C.card, borderWidth: 1, borderColor: C.line },
  pillTabActive: { backgroundColor: C.brandDeep, borderColor: C.brandDeep },
  pillTabTxt: { fontSize: 12, fontWeight: "700", color: C.muted },
  pillTabTxtActive: { color: "#fff" },
  segTrack: { flexDirection: "row", marginVertical: 10, marginHorizontal: 18, padding: 3, borderRadius: 999, backgroundColor: C.card, borderWidth: 1, borderColor: C.line },
  segThumb: { position: "absolute", top: 3, bottom: 3, left: 3, borderRadius: 999, backgroundColor: C.brandDeep },
  segItem: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 8, paddingHorizontal: 6 },

  subRow: { flexDirection: "row", gap: 6, paddingTop: 2, paddingBottom: 12 },
  subTab: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: C.brandFaint },
  subTabActive: { backgroundColor: C.brandDeep },
  subTabTxt: { fontSize: 11.5, fontWeight: "700", color: C.brandDeep },
  subTabTxtActive: { color: "#fff" },

  grmTabs: { flexDirection: "row", gap: 6, paddingTop: 12, paddingHorizontal: 16 },
  grmTab: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 10, backgroundColor: C.brandFaint },
  grmTabActive: { backgroundColor: C.brandDeep },
  grmTabTxt: { fontSize: 12.5, fontWeight: "700", color: C.muted },

  fdTrigger: { marginTop: 12, marginHorizontal: 18, marginBottom: 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  fdPill: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: C.brandFaint, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999 },
  fdPillTxt: { fontSize: 12.5, fontWeight: "700", color: C.brandDeep },
  fdCount: { backgroundColor: C.brandDeep, width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  fdCountTxt: { color: "#fff", fontSize: 10, fontWeight: "800" },
  fdSummary: { fontSize: 11.5, color: C.muted, fontWeight: "600" },
});
