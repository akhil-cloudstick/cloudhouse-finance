import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Animated, Easing, Image, Keyboard, Pressable, ScrollView, StyleSheet, View, type ScrollViewProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router as globalRouter, useIsFocused, useNavigation, useRoute, useRouter } from "expo-router";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Buffering, C, Fade, Txt, pullRefreshControl } from "./base";
import { PIcon } from "./PIcon";
import { notifyLayoutShift, notifyUserScroll } from "./Popover";
import { setOverlayOrigin } from "./overlayOrigin";
import { PCONTENT_BOTTOM, PHEADER_FADE, PTAB_HEIGHT, PTAB_INSET, tabBarLift } from "../../theme/layout";
import { useAuth } from "../../auth/AuthContext";
import { HEADER_LOGO } from "../../config/brand";
import { usePullRefresh } from "../../hooks/usePullRefresh";
import { useKeyboardVisible } from "../../hooks/useKeyboardVisible";

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
  /** Collect Payment for a loan, right over the current page. */
  openCollect: (loanId: number) => void;
};
const noop = () => {};
export const ShellContext = createContext<ShellActions>({
  openNewLoan: noop,
  openMore: noop,
  openSearch: noop,
  openGoldRate: noop,
  openReminders: noop,
  openProfile: noop,
  openCollect: noop,
});
export const useShell = () => useContext(ShellContext);

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

let heroGradId = 0;
/** The Dashboard hero's gradient — linear-gradient(135deg, nav 0%, nav2
 * 55%, brand 100%) — used behind every page header (and the status bar
 * area above it) so the whole app wears the same colour on top. */
export function HeroBackground() {
  const id = React.useMemo(() => `heroGrad${++heroGradId}`, []);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={C.nav} />
            <Stop offset="0.55" stopColor={C.nav2} />
            <Stop offset="1" stopColor={C.brand} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

type HeaderIcon = { icon: string; onPress: () => void; label?: string; dot?: boolean };

/** .flat-header — every page except the Dashboard. New loans are created
 * from the Loans page's + button, the centre Loans tab, or the Dashboard's
 * quick action — not from page headers. */
export function FlatHeader({
  title,
  subtitle,
  back,
  onBack,
  icons = [],
}: {
  title: string;
  subtitle?: string;
  /** Show the back button (router.back() unless onBack is given). */
  back?: boolean;
  onBack?: () => void;
  icons?: HeaderIcon[];
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { openProfile } = useShell();
  return (
    <View style={[s.flatHeader, { paddingTop: insets.top + 12 }]}>
      <HeroBackground />
      <View style={s.flatTopRow}>
        {back ? (
          <Pressable
            style={s.backBtn}
            hitSlop={6}
            accessibilityLabel="Back"
            onPress={() => (onBack ? onBack() : router.canGoBack() ? router.back() : router.replace("/(tabs)/dashboard"))}
          >
            <PIcon name="back" color="#fff" />
          </Pressable>
        ) : null}
        {/* The logo opens the profile sheet (sign out) on every page. */}
        <Pressable onPress={openProfile} hitSlop={4} accessibilityLabel="Profile and sign out">
          <Image source={HEADER_LOGO} style={s.flatLogo} resizeMode="contain" />
        </Pressable>
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
              <PIcon name={ic.icon} color="#fff" />
              {ic.dot ? <View style={s.flatDot} /> : null}
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

/** Shown for the moment between leaving a page and the next one drawing. */
const BLANK_HEADER = <FlatHeader title="" />;

/** .a-header — Dashboard hero: identity row, cash in hand, gold rate row,
 * Overview / Activity segment. */
export function HeroHeader({
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
  /** No longer shown (the profile avatar was removed from the header). */
  initials?: string;
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
  const searchBtn = useRef<View>(null);
  return (
    <View style={[s.aHeader, { paddingTop: insets.top + 12 }]}>
      <HeroBackground />
      <View style={s.aTopRow}>
        <Pressable style={s.aId} onPress={onAvatar} hitSlop={4}>
          <Image source={HEADER_LOGO} style={s.flatLogo} resizeMode="contain" accessibilityLabel="CloudHouse" />
          <View>
            <Txt style={s.aName}>{name}</Txt>
            {branch ? <Txt style={s.aBranch}>{branch}</Txt> : null}
          </View>
        </Pressable>
        <View style={s.aIcons}>
          <Pressable
            ref={searchBtn}
            style={s.aIcBtn}
            onPressIn={() =>
              // The search panel grows out of this icon.
              searchBtn.current?.measureInWindow((x, y, w, h) => setOverlayOrigin({ x: x + w / 2, y: y + h / 2 }))
            }
            onPress={onSearch}
            accessibilityLabel="Search"
          >
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
        <View style={{ flexDirection: "row", flexShrink: 1 }}>
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

// ---------------------------------------------------------------------------
// Persistent header. Inside the tabs shell a page doesn't draw its own
// header: every page publishes it to <HeaderHost>, which sits above every
// navigator and shows the header of the page that most recently gained
// focus. Switching pages (tab or push) leaves the header still and only
// swaps its text while the bodies slide underneath. The page keeps an
// invisible copy in place as a spacer of the same height.
//
// Focus is reported by each page itself (useIsFocused + the blur event),
// not read off the root navigation state: that state doesn't always carry
// a nested navigator's routes yet (first login, a module stack), and
// looking pages up in it left the header blank. openPage() blanks the
// header the moment a direct link is followed, so the old page's header
// (e.g. the Dashboard hero) never lingers while the new page renders.
// ---------------------------------------------------------------------------
type HeaderEntry = { node: React.ReactNode; focused: boolean; seq: number };
const headerEntries = new Map<string, HeaderEntry>();
const headerListeners = new Set<() => void>();
let headerSeq = 0;
let headerPending = false;
let headerSnapshot: React.ReactNode = null;
function publishHeader() {
  let best: HeaderEntry | null = null;
  for (const e of headerEntries.values()) if (e.focused && (!best || e.seq > best.seq)) best = e;
  headerSnapshot = headerPending || !best ? BLANK_HEADER : best.node;
  headerListeners.forEach((l) => l());
}
const headerStore = {
  get: () => headerSnapshot,
  set: (key: string, node: React.ReactNode, focused: boolean) => {
    const prev = headerEntries.get(key);
    const gained = focused && !prev?.focused;
    if (gained) headerPending = false;
    headerEntries.set(key, { node, focused, seq: gained ? ++headerSeq : (prev?.seq ?? 0) });
    publishHeader();
  },
  blur: (key: string) => {
    const prev = headerEntries.get(key);
    if (!prev?.focused) return;
    headerEntries.set(key, { ...prev, focused: false });
    publishHeader();
  },
  remove: (key: string) => {
    if (headerEntries.delete(key)) publishHeader();
  },
  /** A page switch is under way: blank until the next page takes focus. */
  pending: () => {
    headerPending = true;
    publishHeader();
  },
  subscribe: (l: () => void) => {
    headerListeners.add(l);
    return () => {
      headerListeners.delete(l);
    };
  },
};
export const HeaderHostContext = createContext(false);

// Material "standard" curve: eases in and out, so the header neither jumps
// off at the start nor stops dead at the end.
const HEADER_MS = 380;
const HEADER_EASE = Easing.bezier(0.4, 0, 0.2, 1);
const HEADER_FADE_MS = 220;

type Curtain = { h: number; content: React.ReactNode };

/** Mounted once by app/(tabs)/_layout.tsx, after the navigator.
 *
 * Leaving the Dashboard swaps its tall hero for a page's short flat header,
 * which used to happen in one frame and read as the header snapping
 * shorter. The swap is spotted during render (the node's type changes), so
 * in that same frame the hero's last content is kept as a "curtain" behind
 * the new header: it slides up to the new header's bottom edge while its
 * content fades, and the new header fades in on top. Coming back, the hero
 * mounts shifted up so only its bottom strip shows, then slides down.
 * Every animation here runs on the native driver, so a heavy page mounting
 * underneath can't make the header stutter. */
export function HeaderHost() {
  const node = useSyncExternalStore(headerStore.subscribe, headerStore.get, headerStore.get);
  const tall = React.isValidElement(node) && node.type === HeroHeader;
  // Last measured height of each kind of header (0 until first seen).
  const [heights, setHeights] = useState({ tall: 0, short: 0 });
  // The most recent hero, kept so the curtain can carry its content away.
  const [heroNode, setHeroNode] = useState<React.ReactNode>(tall ? node : null);
  if (tall && heroNode !== node) setHeroNode(node);

  const [curtain, setCurtain] = useState<Curtain | null>(null);
  const [curtainY] = useState(() => new Animated.Value(0));
  const [curtainFade] = useState(() => new Animated.Value(1));
  const [headerFade] = useState(() => new Animated.Value(1));
  // Growing remounts the wrapper (new key) so it mounts already holding the
  // shifted-up offset — a native value changed on a view that's already
  // mounted can reach the screen a frame after the new hero does.
  const [dropY] = useState(() => new Animated.Value(0));
  const [growKey, setGrowKey] = useState(0);
  const [growing, setGrowing] = useState(false);

  const [prevTall, setPrevTall] = useState(tall);
  if (prevTall !== tall) {
    setPrevTall(tall);
    if (!tall && heights.tall) {
      curtainY.setValue(0);
      curtainFade.setValue(1);
      headerFade.setValue(0);
      setCurtain({ h: heights.tall, content: heroNode });
      setGrowing(false);
    } else if (tall && heights.tall && heights.short) {
      setCurtain(null);
      headerFade.setValue(1);
      dropY.setValue(heights.short - heights.tall);
      setGrowKey((k) => k + 1);
      setGrowing(true);
    }
  }

  const onLayout = (h: number) => {
    if (h <= 0) return;
    const kind = tall ? "tall" : "short";
    if (heights[kind] !== h) setHeights((prev) => ({ ...prev, [kind]: h }));
    if (!tall && curtain != null) {
      Animated.parallel([
        Animated.timing(curtainY, { toValue: Math.min(0, h - curtain.h), duration: HEADER_MS, easing: HEADER_EASE, useNativeDriver: true }),
        Animated.timing(curtainFade, { toValue: 0, duration: HEADER_FADE_MS, easing: HEADER_EASE, useNativeDriver: true }),
        Animated.timing(headerFade, { toValue: 1, duration: HEADER_FADE_MS, delay: 60, easing: HEADER_EASE, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setCurtain(null);
      });
    } else if (tall && growing) {
      Animated.timing(dropY, { toValue: 0, duration: HEADER_MS, easing: HEADER_EASE, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setGrowing(false);
      });
    }
  };

  return (
    <View style={s.headerHost} pointerEvents="box-none">
      {curtain != null ? (
        <Animated.View pointerEvents="none" style={[s.headerCurtain, { height: curtain.h, transform: [{ translateY: curtainY }] }]}>
          <HeroBackground />
          <Animated.View style={{ opacity: curtainFade }}>{curtain.content}</Animated.View>
        </Animated.View>
      ) : null}
      <Animated.View
        key={growKey}
        pointerEvents="box-none"
        style={{ opacity: headerFade, transform: [{ translateY: growing ? dropY : 0 }] }}
        onLayout={(e) => onLayout(e.nativeEvent.layout.height)}
      >
        {node}
      </Animated.View>
    </View>
  );
}

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
  const hosted = useContext(HeaderHostContext);
  const routeKey = useRoute().key;
  const navigation = useNavigation();
  const focused = useIsFocused();
  // Every render, so the hosted header tracks the page's state.
  useLayoutEffect(() => {
    if (hosted) headerStore.set(routeKey, header, focused);
  });
  // The blur event still fires for a page that's frozen once hidden (it
  // can't re-render to report focused=false itself).
  useEffect(() => {
    if (!hosted) return;
    // Leaving a page (tab, push, back) also closes a keyboard opened on it.
    const off = navigation.addListener("blur", () => {
      Keyboard.dismiss();
      headerStore.blur(routeKey);
    });
    return () => {
      off();
      headerStore.remove(routeKey);
    };
  }, [hosted, routeKey, navigation]);
  return (
    <View style={s.screen}>
      <View
        style={[s.headerShell, hosted && s.headerSpacer]}
        pointerEvents={hosted ? "none" : "auto"}
        importantForAccessibility={hosted ? "no-hide-descendants" : "auto"}
      >
        {header}
      </View>
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
  const { pullRefreshing, onPull } = usePullRefresh(!!refreshing, onRefresh);
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={onPull ? pullRefreshControl(pullRefreshing, onPull) : undefined}
      scrollEventThrottle={16}
      {...rest}
      onScroll={(e) => {
        notifyLayoutShift();
        rest.onScroll?.(e);
      }}
      onScrollBeginDrag={(e) => {
        notifyUserScroll();
        rest.onScrollBeginDrag?.(e);
      }}
      contentContainerStyle={[{ paddingBottom: PCONTENT_BOTTOM + tabBarLift(insets.bottom) + extraBottom }, contentContainerStyle]}
    >
      {pullRefreshing ? <Buffering style={{ paddingVertical: 10 }} /> : null}
      {children}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Floating page elements
// ---------------------------------------------------------------------------

/** .fab-corner — bottom-right, above the tab bar. */
export function FabCorner({
  onPress,
  icon = "plus",
  label,
  side = "right",
  caption,
}: {
  onPress: () => void;
  icon?: string;
  label?: string;
  side?: "left" | "right";
  /** Small name shown under the button (e.g. "Plans"). */
  caption?: string;
}) {
  const insets = useSafeAreaInsets();
  if (caption)
    return (
      // The caption sits where an uncaptioned FAB's bottom edge would be, so
      // the whole button + label stays clear of the tab bar below it.
      <View style={[s.fabWrap, { bottom: 96 + tabBarLift(insets.bottom) }, side === "left" ? { left: 16 } : { right: 16 }]} pointerEvents="box-none">
        <Pressable style={[s.fab, s.fabInline]} onPress={onPress} accessibilityLabel={label ?? caption}>
          <PIcon name={icon} color="#fff" />
        </Pressable>
        <Txt style={s.fabCaption} numberOfLines={1}>{caption}</Txt>
      </View>
    );
  return (
    <Pressable style={[s.fab, { bottom: 96 + FAB_CAPTION_H + tabBarLift(insets.bottom) }, side === "left" ? { left: 16, right: undefined } : null]} onPress={onPress} accessibilityLabel={label ?? "Add"}>
      <PIcon name={icon} color="#fff" />
    </Pressable>
  );
}

const FAB_CAPTION_H = 18;
const FAB_MENU_W = 72;

/** One corner button that opens upward into a panel of actions (like a
 * phone's side-panel launcher): closed it's a round chevron button; tapped,
 * a rounded panel rises out of it listing each action as an icon with its
 * name, and the chevron turns to fold it back. Tapping outside or picking
 * an action closes it. */
export function FabMenu({ actions, label = "More actions" }: { actions: { label: string; icon: string; onPress: () => void }[]; label?: string }) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [anim] = useState(() => new Animated.Value(0));
  const toggle = (next: boolean) => {
    setOpen(next);
    Animated.spring(anim, {
      toValue: next ? 1 : 0,
      damping: 20,
      stiffness: 260,
      mass: 0.9,
      overshootClamping: !next,
      useNativeDriver: true,
    }).start();
  };
  const bottom = 96 + FAB_CAPTION_H + tabBarLift(insets.bottom);
  return (
    <>
      {open ? <Pressable style={[StyleSheet.absoluteFill, { zIndex: 44 }]} onPress={() => toggle(false)} accessibilityLabel="Close actions" /> : null}
      <Animated.View
        pointerEvents={open ? "auto" : "none"}
        style={[
          s.fabMenu,
          { bottom: bottom - 6 },
          {
            opacity: anim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
            transformOrigin: "bottom",
            transform: [
              { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
              { scaleY: anim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) },
              { scaleX: anim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
            ],
          },
        ]}
      >
        {actions.map((a) => (
          <Pressable
            key={a.label}
            style={({ pressed }) => [s.fabMenuItem, pressed && { opacity: 0.6 }]}
            onPress={() => {
              toggle(false);
              a.onPress();
            }}
            accessibilityLabel={a.label}
          >
            <View style={s.fabMenuIc}>
              <PIcon name={a.icon} color={C.brandDeep} />
            </View>
            <Txt style={s.fabMenuLbl} numberOfLines={2}>
              {a.label}
            </Txt>
          </Pressable>
        ))}
        {/* room for the toggle button, which sits over the panel's foot */}
        <View style={{ height: 58 }} />
      </Animated.View>
      <Pressable style={[s.fab, { bottom }]} onPress={() => toggle(!open)} accessibilityLabel={open ? "Close actions" : label}>
        <Animated.View style={{ transform: [{ rotate: anim.interpolate({ inputRange: [0, 1], outputRange: ["180deg", "0deg"] }) }] }}>
          <PIcon name="chevdown" color="#fff" />
        </Animated.View>
      </Pressable>
    </>
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
    <View style={[s.ldBar, { bottom: 102 + tabBarLift(insets.bottom) }]} pointerEvents="box-none">
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
  { route: "customers", label: "Customers", icon: "user", module: "Customer_Management", key: "can_view_customer" },
  { route: "loans", label: "Loans", icon: "note", fab: true, module: "Loan_Management", key: "can_view_loan" },
  { route: "schemes", label: "Schemes", icon: "layers", module: "Scheme_Management", key: "can_view_scheme" },
];

// How far the tab bar's fade reaches above the bar itself.
const TAB_FADE_ABOVE = 36;

// ---------------------------------------------------------------------------
// Cross-page navigation
// ---------------------------------------------------------------------------
type TabsNav = BottomTabBarProps["navigation"];
type TabsState = BottomTabBarProps["state"];
const tabsRef: { nav: TabsNav | null; state: TabsState | null } = { nav: null, state: null };

let directSeq = 0;

// Tabs that are folders (their own stack: index + [id]); the rest are a
// single screen.
const STACK_TABS = new Set([
  "customers",
  "loans",
  "schemes",
  "auctions",
  "packets",
  "banks",
  "cash",
  "personal-loans",
  "investments",
  "employees",
  "branches",
  "settings",
]);

function parsePath(path: string) {
  const [pathname, query = ""] = path.split("?");
  const parts = pathname.replace(/^\/+/, "").replace(/^\(tabs\)\/?/, "").split("/").filter(Boolean);
  const params: Record<string, string> = {};
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const [k, v = ""] = pair.split("=");
    params[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return { tab: parts[0] ?? "", id: parts[1], params };
}

/**
 * Open a page from anywhere (dashboard quick links, search hits, "View
 * Loan" on another module…). Within the current tab it's a normal push.
 *
 * Across tabs, switching the active tab and resetting its stack to just the
 * destination screen are done as ONE dispatch on the tabs navigator itself
 * (a RESET of its whole state, not two separate `navigate`/`dispatch`
 * calls). React Navigation applies a dispatch as a single state update —
 * there's no render in between where the target tab is visible with its old
 * content, because it was never made visible with any content but the
 * destination. Doing this in two steps (make the tab visible, THEN swap its
 * stack) always leaves a gap — however briefly — where the tab shows
 * whatever it last had (its list), which is exactly the flash this avoids.
 * Back returns to the page it was opened from (the tabs keep a history).
 */
export function openPage(path: string) {
  const { nav, state } = tabsRef;
  const { tab, id, params } = parsePath(path);
  const targetIndex = state?.routes.findIndex((r) => r.name === tab) ?? -1;
  const target = targetIndex >= 0 ? state?.routes[targetIndex] : undefined;
  const current = state?.routes[state?.index ?? -1]?.name;
  if (!nav || !state || !target || current === tab) {
    globalRouter.push(path as never);
    return;
  }
  headerStore.pending();
  const screen = id ? "[id]" : "index";
  const screenParams = id ? { ...params, id, direct: "1" } : params;
  // The guard above already ruled out `current === tab` — this is always a
  // cross-tab jump, so the target's own stack (whatever it was left showing)
  // is never the thing about to become visible; it's always being replaced.
  //
  // The target stack is given exactly ONE route, the destination. Its
  // navigator uses a `route.state` handed down like this whether it's
  // already mounted or mounting for the first time (useNavigationBuilder
  // rehydrates from it), and StackRouter keeps just the routes it's given —
  // so the list is never created underneath, never flashes, and isn't there
  // for Back to land on. Back from the detail therefore falls straight
  // through to the tabs' history: the page it was opened from.
  if (!STACK_TABS.has(tab)) {
    focusTab(nav, state, targetIndex, { params });
    return;
  }
  focusTab(nav, state, targetIndex, { stack: { name: screen, params: screenParams } });
}

/**
 * Focus a tab and, optionally, set its stack to a single screen — all in one
 * RESET of the TABS navigator's own state.
 *
 * Why not address the tab's nested stack directly (`target: nested.key`)?
 * The stack state openPage() hands down is rehydrated by the stack's own
 * navigator, which gives it a NEW key and only reports that back up to the
 * tabs state after the next action inside that stack. Until then the tabs
 * state still holds the old key, so an action targeted at it reaches no
 * navigator ("The action 'RESET' … was not handled by any navigator").
 * Going through the tabs navigator never needs that key.
 */
function focusTab(
  nav: TabsNav,
  state: TabsState,
  targetIndex: number,
  change: { params?: object; stack?: { name: string; params?: object } }
) {
  const target = state.routes[targetIndex];
  const routes = state.routes.map((r, i) => {
    if (i !== targetIndex) return r;
    if (change.stack) {
      const n = ++directSeq;
      return {
        ...r,
        state: { type: "stack" as const, key: `direct-stack-${n}`, index: 0, routes: [{ key: `direct-${n}`, ...change.stack }] },
      };
    }
    return change.params ? { ...r, params: change.params } : r;
  });
  // The tab router's own back-navigation (both hardware Back and this
  // Tabs' `backBehavior="history"`) is driven entirely by `state.history`,
  // a list of previously-focused route keys that only its own actions
  // (JUMP_TO/NAVIGATE/GO_BACK) know how to maintain — a raw RESET, if it
  // doesn't include one, replaces it with nothing. `target.key` doesn't
  // change (only its nested `state` does, above), so it's still valid to
  // reference: move it to the end, exactly like the router's own
  // changeIndex does for backBehavior="history" (de-dupe, then append).
  // Skipping this was the bug — Back from a loan opened this way had no
  // history left to fall into, and Android closed the app outright.
  const history = (state.history ?? [])
    .filter((it) => (it && typeof it === "object" && "key" in it ? it.key !== target.key : true))
    .concat({ type: "route" as const, key: target.key });
  nav.dispatch({ type: "RESET", payload: { ...state, index: targetIndex, routes, history } });
}

/** .tabbar + .tabfade — Dashboard / Customers / Loans (centre FAB) / Schemes / More. */
export function PTabBar({ state, navigation }: BottomTabBarProps) {
  useLayoutEffect(() => {
    tabsRef.nav = navigation;
    tabsRef.state = state;
  });
  const keyboardUp = useKeyboardVisible();
  const insets = useSafeAreaInsets();
  const { openMore } = useShell();
  const { can } = useAuth();
  const navRoute = state.routes[state.index]?.name;
  // The tapped tab lights up on touch-down, before the (heavier) new page
  // renders: the highlight commits first and navigation follows on the next
  // frame, so bar and page change together instead of the bar lagging.
  const [pressed, setPressed] = useState<string | null>(null);
  // Navigation has caught up with the tap: drop the early highlight. Done
  // during render (React's "adjust state when a value changes" pattern), not
  // in an effect — an effect would paint once with the stale value and then
  // re-render, which is exactly the cascade the lint rule flags.
  if (pressed && pressed === navRoute) setPressed(null);
  const activeRoute = pressed && pressed !== navRoute ? pressed : navRoute;
  const tabs = TABS.filter((t) => !t.module || can(t.module, t.key!));
  const isPrimary = tabs.some((t) => t.route === activeRoute);

  function go(name: string) {
    const route = state.routes.find((r) => r.name === name);
    if (!route) return;
    if (route.name !== navRoute) setPressed(route.name);
    requestAnimationFrame(() => navigateTo(route));
  }

  function navigateTo(route: (typeof state.routes)[number]) {
    const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
    if (event.defaultPrevented) return setPressed(null);
    // Always land on the tab's root list (a deep push, or a page opened
    // from another tab, can leave the nested stack parked on a detail).
    const nested = route.state;
    if (nested?.type === "stack" && nested.routes?.[0]?.name !== "index") {
      // Opened via openPage(): the stack holds only a detail page, and its
      // key in this state may be stale (see focusTab). Swap it for the list
      // and focus the tab in one step, through the tabs navigator itself.
      focusTab(navigation, state, state.routes.indexOf(route), { stack: { name: "index" } });
      if (route.name === navRoute) setPressed(null);
      return;
    }
    if (nested?.type === "stack" && nested.key && (nested.index ?? 0) > 0) {
      // A stack with the list at its root got here by pushes made inside
      // it, so its navigator has reported its real key — safe to target.
      navigation.dispatch({ type: "POP_TO_TOP", target: nested.key });
    }
    if (route.name !== navRoute) navigation.navigate(route.name);
    else setPressed(null);
  }

  // Hidden while typing: on devices where the window resizes for the
  // keyboard, the bottom-anchored bar would otherwise ride up above it.
  if (keyboardUp) return null;

  return (
    <>
      {/* Gradual fade covering the bar's full height plus a strip above it,
          so content eases out before it reaches the bar instead of meeting
          a hard edge. */}
      <Fade from="bottom" height={PTAB_INSET + PTAB_HEIGHT + TAB_FADE_ABOVE + tabBarLift(insets.bottom)} solidAt={0.6} style={s.tabFade} />
      <View style={[s.tabbar, { bottom: PTAB_INSET + tabBarLift(insets.bottom) }]}>
        {tabs.map((t) => {
          const active = t.route === activeRoute;
          if (t.fab) {
            return (
              <Pressable key={t.route} style={s.tabFab} onPressIn={() => go(t.route)} accessibilityLabel={t.label}>
                <View style={[s.tabFabIc, active && s.tabFabIcActive]}>
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
  headerSpacer: { opacity: 0 },
  headerHost: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 30 },
  // Same rounded bottom as the hero (aHeader) it stands in for.
  headerCurtain: { position: "absolute", top: 0, left: 0, right: 0, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, overflow: "hidden" },
  body: { flex: 1 },
  headerFade: { position: "absolute", top: 0, left: 0, right: 0 },

  // .flat-header
  // Hero-coloured like the Dashboard header (HeroBackground), white on top.
  flatHeader: { paddingHorizontal: 18, paddingBottom: 14, borderBottomLeftRadius: 22, borderBottomRightRadius: 22, overflow: "hidden", backgroundColor: C.nav },
  flatTopRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  backBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" },
  flatLogo: { width: 38, height: 38 },
  flatTitleBlock: { flex: 1, minWidth: 0 },
  flatTitle: { fontSize: 16, fontWeight: "700", lineHeight: 19, color: "#fff" },
  flatSub: { fontSize: 11.5, color: "rgba(255,255,255,0.72)", marginTop: 1 },
  flatIcons: { flexDirection: "row", gap: 6 },
  flatIcBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" },
  flatDot: { position: "absolute", top: 6, right: 6, width: 6, height: 6, borderRadius: 3, backgroundColor: "#ffd166" },

  // .a-header
  aHeader: { paddingHorizontal: 18, paddingBottom: 18, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, overflow: "hidden" },
  aTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  aId: { flexDirection: "row", alignItems: "center", gap: 8 },
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
  rateSegNext: { marginLeft: 12, paddingLeft: 12, borderLeftWidth: 1, borderLeftColor: "rgba(255,255,255,0.25)" },
  rateK: { color: "#fff", fontSize: 10, fontWeight: "700", opacity: 0.75, textTransform: "uppercase", letterSpacing: 0.4 },
  rateV: { color: "#fff", fontSize: 14, fontWeight: "800" },
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
    // Above the tab bar's fade (40), below the bar itself (50).
    zIndex: 45,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: C.brandDeep,
    alignItems: "center",
    justifyContent: "center",
    ...shadow(10, 22, 0.3, "0, 0, 0"),
  },
  // Exactly the button's width, so left and right FABs sit the same 16px
  // from their edges whatever their caption length; the caption is centred
  // under the button and may overhang it.
  // FabMenu panel: a rounded column rising from the corner button.
  fabMenu: {
    position: "absolute",
    // Centred on the corner button (right 16 + 52/2 = 42 from the edge).
    right: 42 - FAB_MENU_W / 2,
    zIndex: 45,
    width: FAB_MENU_W,
    paddingTop: 14,
    borderRadius: 30,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: "center",
    gap: 12,
    ...shadow(12, 30, 0.22),
  },
  fabMenuItem: { alignItems: "center", width: "100%", paddingHorizontal: 6 },
  fabMenuIc: { width: 48, height: 48, borderRadius: 16, backgroundColor: C.brandFaint, alignItems: "center", justifyContent: "center" },
  fabMenuLbl: { marginTop: 5, fontSize: 11, fontWeight: "700", color: C.ink, textAlign: "center" },
  fabWrap: { position: "absolute", zIndex: 45, width: 52, alignItems: "center", overflow: "visible" },
  fabInline: { position: "relative", right: undefined },
  fabCaption: { width: 96, height: FAB_CAPTION_H, paddingTop: 4, fontSize: 11, fontWeight: "700", color: C.brandDeep, textAlign: "center" },

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
  tabIc: { width: 54, height: 36, borderRadius: 18, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  tabIcActive: { backgroundColor: C.brandPale },
  tabLbl: { fontSize: 10, fontWeight: "600", color: C.muted },
  tabLblActive: { color: C.brandDeep },
  tabFab: { top: -22 },
  // Centre Loans button while Loans is the open tab: brighter fill, a soft
  // brand ring and glow, slightly larger.
  tabFabIcActive: {
    backgroundColor: C.brand,
    borderColor: C.brandPale,
    transform: [{ scale: 1.06 }],
    boxShadow: "0px 6px 18px rgba(138, 32, 53, 0.45)",
  },
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
