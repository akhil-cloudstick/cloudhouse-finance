import React, { createContext, useContext } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View, type ScrollViewProps, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { C, Fade, Txt } from "./base";
import { PIcon } from "./PIcon";
import { PCONTENT_BOTTOM, PHEADER_FADE, PTAB_FADE, PTAB_HEIGHT, PTAB_INSET } from "../../theme/layout";
import { useAuth } from "../../auth/AuthContext";

// ---------------------------------------------------------------------------
// Shell actions — one set of global openers (New Loan sheet, More sheet,
// search, gold rate, reminders) provided by app/(tabs)/_layout.tsx so every
// header / quick action drives the same sheet instance.
// ---------------------------------------------------------------------------
export type ShellActions = {
  openNewLoan: () => void;
  openMore: () => void;
  openSearch: () => void;
  openGoldRate: () => void;
  openReminders: () => void;
  openProfile: () => void;
};
const noop = () => {};
export const ShellContext = createContext<ShellActions>({
  openNewLoan: noop,
  openMore: noop,
  openSearch: noop,
  openGoldRate: noop,
  openReminders: noop,
  openProfile: noop,
});
export const useShell = () => useContext(ShellContext);

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

type HeaderIcon = { icon: string; onPress: () => void; label?: string; dot?: boolean };

/** .flat-header — every page except the Dashboard. The square-primary New
 * Loan button is appended automatically (prototype script L3090) unless
 * `hideNewLoan` (or the role can't create loans). */
export function FlatHeader({
  title,
  subtitle,
  back,
  onBack,
  icons = [],
  hideNewLoan,
}: {
  title: string;
  subtitle?: string;
  /** Show the back button (router.back() unless onBack is given). */
  back?: boolean;
  onBack?: () => void;
  icons?: HeaderIcon[];
  hideNewLoan?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { openNewLoan } = useShell();
  const { can } = useAuth();
  const showNewLoan = !hideNewLoan && can("Loan_Management", "can_create_loan");
  return (
    <View style={[s.flatHeader, { paddingTop: insets.top + 12 }]}>
      <View style={s.flatTopRow}>
        {back ? (
          <Pressable
            style={s.backBtn}
            hitSlop={6}
            accessibilityLabel="Back"
            onPress={() => (onBack ? onBack() : router.canGoBack() ? router.back() : router.replace("/(tabs)/dashboard"))}
          >
            <PIcon name="back" color={C.brandDeep} />
          </Pressable>
        ) : null}
        <View style={s.flatTitleBlock}>
          <Txt style={s.flatTitle} numberOfLines={1}>
            {title}
          </Txt>
          {subtitle ? (
            <Txt style={s.flatSub} numberOfLines={1}>
              {subtitle}
            </Txt>
          ) : null}
        </View>
        <View style={s.flatIcons}>
          {icons.map((ic) => (
            <Pressable key={ic.icon} style={s.flatIcBtn} onPress={ic.onPress} hitSlop={4} accessibilityLabel={ic.label ?? ic.icon}>
              <PIcon name={ic.icon} color={C.brandDeep} />
              {ic.dot ? <View style={s.flatDot} /> : null}
            </Pressable>
          ))}
          {showNewLoan ? (
            <Pressable style={[s.flatIcBtn, s.squarePrimary]} onPress={openNewLoan} hitSlop={4} accessibilityLabel="New loan">
              <PIcon name="plus" color="#fff" />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** .a-header — Dashboard hero: identity row, cash in hand, gold rate row,
 * Overview / Activity segment. */
export function HeroHeader({
  initials,
  name,
  branch,
  cashLabel = "Cash in hand",
  cashValue,
  rates,
  rateChange,
  onRatePress,
  onSearch,
  onBell,
  bellDot,
  onAvatar,
  segments,
  activeSegment,
  onSegment,
}: {
  initials: string;
  name: string;
  branch?: string;
  cashLabel?: string;
  cashValue: string;
  rates: { k: string; v: string }[];
  rateChange?: string;
  onRatePress?: () => void;
  onSearch: () => void;
  onBell: () => void;
  bellDot?: boolean;
  onAvatar?: () => void;
  segments: string[];
  activeSegment: string;
  onSegment: (s: string) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.aHeader, { paddingTop: insets.top + 12 }]}>
      {/* linear-gradient(135deg, nav 0%, nav2 55%, brand 100%) */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="heroGrad" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={C.nav} />
              <Stop offset="0.55" stopColor={C.nav2} />
              <Stop offset="1" stopColor={C.brand} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroGrad)" />
        </Svg>
      </View>
      <View style={s.aTopRow}>
        <Pressable style={s.aId} onPress={onAvatar} hitSlop={4}>
          <View style={s.aAvatar}>
            <Txt style={s.aAvatarTxt}>{initials}</Txt>
          </View>
          <View>
            <Txt style={s.aName}>{name}</Txt>
            {branch ? <Txt style={s.aBranch}>{branch}</Txt> : null}
          </View>
        </Pressable>
        <View style={s.aIcons}>
          <Pressable style={s.aIcBtn} onPress={onSearch} accessibilityLabel="Search">
            <PIcon name="search" color="#fff" />
          </Pressable>
          <Pressable style={s.aIcBtn} onPress={onBell} accessibilityLabel="Reminders">
            <PIcon name="bell" color="#fff" />
            {bellDot ? <View style={s.aDot} /> : null}
          </Pressable>
        </View>
      </View>
      <View style={s.aHero}>
        <Txt style={s.aHeroL}>{cashLabel}</Txt>
        <Txt style={s.aHeroV}>{cashValue}</Txt>
      </View>
      <Pressable style={s.rateRow} onPress={onRatePress}>
        <View style={{ flexDirection: "row" }}>
          {rates.map((r, i) => (
            <View key={r.k} style={[s.rateSeg, i > 0 && s.rateSegNext]}>
              <Txt style={s.rateK}>{r.k}</Txt>
              <Txt style={s.rateV}>{r.v}</Txt>
            </View>
          ))}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {rateChange ? <Txt style={s.rateChange}>{rateChange}</Txt> : null}
          <View style={{ opacity: 0.7 }}>
            <PIcon name="chevron" color="#fff" />
          </View>
        </View>
      </Pressable>
      <View style={s.aSegment}>
        {segments.map((seg) => {
          const active = seg === activeSegment;
          return (
            <Pressable key={seg} style={[s.aSegItem, active && s.aSegItemActive]} onPress={() => onSegment(seg)}>
              <Txt style={[s.aSegTxt, active && s.aSegTxtActive]}>{seg}</Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen + scroller
// ---------------------------------------------------------------------------

/** Page shell: header on top, body below with a gradual fade under the
 * header so content scrolls away smoothly. `floating` renders page-level
 * floating elements (FAB, action bar) above the body. */
export function Screen({
  header,
  children,
  floating,
  headerFade = true,
}: {
  header: React.ReactNode;
  children: React.ReactNode;
  floating?: React.ReactNode;
  headerFade?: boolean;
}) {
  return (
    <View style={s.screen}>
      <View style={s.headerShell}>{header}</View>
      <View style={s.body}>
        {children}
        {headerFade ? <Fade from="top" height={PHEADER_FADE} style={s.headerFade} /> : null}
      </View>
      {floating}
    </View>
  );
}

/** .content — vertical scroller that clears the floating tab bar. */
export function PScroll({
  children,
  refreshing,
  onRefresh,
  contentContainerStyle,
  extraBottom = 0,
  ...rest
}: ScrollViewProps & { refreshing?: boolean; onRefresh?: () => void; extraBottom?: number }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={C.brandDeep} colors={[C.brandDeep]} /> : undefined}
      {...rest}
      contentContainerStyle={[{ paddingBottom: PCONTENT_BOTTOM + insets.bottom + extraBottom }, contentContainerStyle]}
    >
      {children}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Floating page elements
// ---------------------------------------------------------------------------

/** .fab-corner — bottom-right, above the tab bar. */
export function FabCorner({ onPress, icon = "plus", label }: { onPress: () => void; icon?: string; label?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <Pressable style={[s.fab, { bottom: 96 + insets.bottom }]} onPress={onPress} accessibilityLabel={label ?? "Add"}>
      <PIcon name={icon} color="#fff" />
    </Pressable>
  );
}

/** .ld-actions-bar — floating pair (or trio) of buttons above the tab bar. */
export function ActionsBar({
  actions,
}: {
  actions: { label: string; icon?: string; onPress: () => void; primary?: boolean; disabled?: boolean; tone?: "danger" }[];
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.ldBar, { bottom: 94 + insets.bottom }]} pointerEvents="box-none">
      {actions.map((a) => {
        const fg = a.primary ? "#fff" : a.tone === "danger" ? C.red : C.brandDeep;
        return (
          <Pressable
            key={a.label}
            disabled={a.disabled}
            onPress={a.onPress}
            style={[s.ldBtn, a.primary && s.ldBtnPrimary, a.disabled && { opacity: 0.45 }]}
          >
            {a.icon ? <PIcon name={a.icon} color={fg} /> : null}
            <Txt style={[s.ldBtnTxt, { color: fg }]}>{a.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Bottom tab bar
// ---------------------------------------------------------------------------

type TabDef = { route: string; label: string; icon: string; fab?: boolean; module?: string; key?: string };
const TABS: TabDef[] = [
  { route: "dashboard", label: "Dashboard", icon: "home" },
  { route: "loans", label: "Loans", icon: "note", module: "Loan_Management", key: "can_view_loan" },
  { route: "customers", label: "Customers", icon: "user", fab: true, module: "Customer_Management", key: "can_view_customer" },
  { route: "schemes", label: "Schemes", icon: "layers", module: "Scheme_Management", key: "can_view_scheme" },
];

/** .tabbar + .tabfade — Dashboard / Loans / Customers (centre FAB) / Schemes / More. */
export function PTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { openMore } = useShell();
  const { can } = useAuth();
  const activeRoute = state.routes[state.index]?.name;
  const tabs = TABS.filter((t) => !t.module || can(t.module, t.key!));
  const isPrimary = tabs.some((t) => t.route === activeRoute);

  function go(name: string) {
    const route = state.routes.find((r) => r.name === name);
    if (!route) return;
    const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
    if (event.defaultPrevented) return;
    // Always land on the tab's root list (a deep push from another tab can
    // leave the nested stack parked on a detail screen).
    const nested = route.state;
    if (nested?.type === "stack" && nested.key && (nested.index ?? 0) > 0) {
      navigation.dispatch({ type: "POP_TO_TOP", target: nested.key });
    }
    if (route.name !== activeRoute) navigation.navigate(route.name);
  }

  return (
    <>
      <Fade from="bottom" height={PTAB_FADE + insets.bottom} solidAt={0.65} style={s.tabFade} />
      <View style={[s.tabbar, { bottom: PTAB_INSET + insets.bottom }]}>
        {tabs.map((t) => {
          const active = t.route === activeRoute;
          if (t.fab) {
            return (
              <Pressable key={t.route} style={s.tabFab} onPressIn={() => go(t.route)} accessibilityLabel={t.label}>
                <View style={s.tabFabIc}>
                  <PIcon name={t.icon} color="#fff" />
                </View>
              </Pressable>
            );
          }
          return (
            <Pressable key={t.route} style={s.tab} onPressIn={() => go(t.route)} accessibilityLabel={t.label}>
              <View style={[s.tabIc, active && s.tabIcActive]}>
                <PIcon name={t.icon} color={active ? C.brandDeep : C.muted} />
              </View>
              <Txt style={[s.tabLbl, active && s.tabLblActive]}>{t.label}</Txt>
            </Pressable>
          );
        })}
        <Pressable style={s.tab} onPressIn={openMore} accessibilityLabel="More">
          <View style={[s.tabIc, !isPrimary && s.tabIcActive]}>
            <PIcon name="dots" color={!isPrimary ? C.brandDeep : C.muted} />
          </View>
          <Txt style={[s.tabLbl, !isPrimary && s.tabLblActive]}>More</Txt>
        </Pressable>
      </View>
    </>
  );
}

const shadow = (y: number, blur: number, opacity: number, color = "43, 26, 94") => ({
  boxShadow: `0px ${y}px ${blur}px rgba(${color}, ${opacity})`,
});

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  headerShell: { zIndex: 20 },
  body: { flex: 1 },
  headerFade: { position: "absolute", top: 0, left: 0, right: 0 },

  // .flat-header
  flatHeader: { paddingHorizontal: 18, paddingBottom: 14, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.line },
  flatTopRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.brandFaint, alignItems: "center", justifyContent: "center" },
  flatTitleBlock: { flex: 1, minWidth: 0 },
  flatTitle: { fontSize: 16, fontWeight: "700", lineHeight: 19 },
  flatSub: { fontSize: 11.5, color: C.muted, marginTop: 1 },
  flatIcons: { flexDirection: "row", gap: 6 },
  flatIcBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.brandFaint, alignItems: "center", justifyContent: "center" },
  flatDot: { position: "absolute", top: 6, right: 6, width: 6, height: 6, borderRadius: 3, backgroundColor: C.red },
  squarePrimary: { borderRadius: 8, backgroundColor: C.brandDeep },

  // .a-header
  aHeader: { paddingHorizontal: 18, paddingBottom: 18, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, overflow: "hidden" },
  aTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  aId: { flexDirection: "row", alignItems: "center", gap: 10 },
  aAvatar: { width: 36, height: 36, borderRadius: 11, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  aAvatarTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },
  aName: { color: "#fff", fontWeight: "700", fontSize: 14 },
  aBranch: { color: "#fff", fontSize: 11, opacity: 0.75 },
  aIcons: { flexDirection: "row", gap: 6 },
  aIcBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" },
  aDot: { position: "absolute", top: 6, right: 6, width: 6, height: 6, borderRadius: 3, backgroundColor: "#ffd166" },
  aHero: { marginTop: 16 },
  aHeroL: { color: "#fff", fontSize: 11, opacity: 0.75, fontWeight: "600" },
  aHeroV: { color: "#fff", fontSize: 27, fontWeight: "800", marginTop: 3 },
  rateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 15,
    backgroundColor: "rgba(255,255,255,0.12)",
    marginTop: 14,
  },
  rateSeg: { gap: 2 },
  rateSegNext: { marginLeft: 18, paddingLeft: 18, borderLeftWidth: 1, borderLeftColor: "rgba(255,255,255,0.25)" },
  rateK: { color: "#fff", fontSize: 10, fontWeight: "700", opacity: 0.75, textTransform: "uppercase", letterSpacing: 0.4 },
  rateV: { color: "#fff", fontSize: 15, fontWeight: "800" },
  rateChange: { color: "#fff", fontSize: 11, fontWeight: "700" },
  aSegment: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.14)", borderRadius: 12, padding: 3, marginTop: 14 },
  aSegItem: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 9 },
  aSegItemActive: { backgroundColor: "#fff" },
  aSegTxt: { fontSize: 12.5, fontWeight: "700", color: "rgba(255,255,255,0.75)" },
  aSegTxtActive: { color: C.brandDeep },

  // .fab-corner
  fab: {
    position: "absolute",
    right: 16,
    zIndex: 36,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: C.brandDeep,
    alignItems: "center",
    justifyContent: "center",
    ...shadow(10, 22, 0.3, "0, 0, 0"),
  },

  // .ld-actions-bar
  ldBar: { position: "absolute", left: 14, right: 14, zIndex: 35, flexDirection: "row", gap: 10 },
  ldBtn: {
    flex: 1,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 16,
    padding: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    ...shadow(6, 16, 0.1),
  },
  ldBtnPrimary: { backgroundColor: C.brandDeep, borderColor: C.brandDeep },
  ldBtnTxt: { fontWeight: "700", fontSize: 13.5 },

  // .tabfade / .tabbar
  tabFade: { position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 40 },
  tabbar: {
    position: "absolute",
    left: PTAB_INSET,
    right: PTAB_INSET,
    zIndex: 50,
    height: PTAB_HEIGHT,
    backgroundColor: C.card,
    borderRadius: 26,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 6,
    ...shadow(6, 16, 0.16),
  },
  tab: { alignItems: "center", gap: 3 },
  tabIc: { width: 54, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  tabIcActive: { backgroundColor: C.brandPale },
  tabLbl: { fontSize: 10, fontWeight: "600", color: C.muted },
  tabLblActive: { color: C.brandDeep },
  tabFab: { top: -22 },
  tabFabIc: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: C.brandDeep,
    borderWidth: 5,
    borderColor: C.bg,
    alignItems: "center",
    justifyContent: "center",
    ...shadow(8, 18, 0.28, "0, 0, 0"),
  },
});
