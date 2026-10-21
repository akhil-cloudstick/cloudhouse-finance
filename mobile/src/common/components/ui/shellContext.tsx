import type { Customer } from "@/modules/customers/types/customer-types";
import React, { createContext, useContext } from "react";
import { Animated, StyleSheet } from "react-native";
import { router as globalRouter } from "expo-router";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { C } from "./base";
import { PTAB_HEIGHT, PTAB_INSET } from "@/common/theme/layout";
import { canOpenPath } from "@/common/config/routePermissions";
import { toast } from "./ToastHost";
import { FlatHeader } from "./FlatHeader";

// Global openers provided by app/(tabs)/_layout.tsx so every header/quick action shares one sheet instance.
export type ShellActions = {
  openNewLoan: () => void;
  /** New Loan with this customer already picked (from the customer page). */
  openNewLoanFor: (customer: Customer) => void;
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
  openNewLoanFor: noop,
  openMore: noop,
  openSearch: noop,
  openGoldRate: noop,
  openReminders: noop,
  openProfile: noop,
  openCollect: noop,
});
export const useShell = () => useContext(ShellContext);

const BLANK_HEADER = <FlatHeader title="" />;

/** p: 0 (hero open) to 1 (collapsed into flat header); lift: height diff between the two. */
export type HeroMorph = { p: Animated.Value; lift: Animated.Value };
export const HeroMorphContext = createContext<HeroMorph | null>(null);

// Persistent header: pages publish to <HeaderHost> instead of drawing their own; focus is
// reported per-page (not from root nav state, which can lag nested navigators). The outgoing
// header is held (not blanked) between pages losing/gaining focus; NavCover hides the body meanwhile.
type CoverPhase = "off" | "on" | "leaving";
let coverPhase: CoverPhase = "off";
let coverTimer: ReturnType<typeof setTimeout> | null = null;
const coverListeners = new Set<() => void>();
export const coverStore = {
  get: () => coverPhase,
  set: (p: CoverPhase) => {
    if (coverPhase === p) return;
    coverPhase = p;
    coverListeners.forEach((l) => l());
  },
  subscribe: (l: () => void) => {
    coverListeners.add(l);
    return () => {
      coverListeners.delete(l);
    };
  },
  begin: () => {
    if (coverTimer) clearTimeout(coverTimer);
    coverStore.set("on");
    coverTimer = setTimeout(coverStore.end, 1500); // safety timeout if destination never reports focus
  },
  end: () => {
    if (coverTimer) clearTimeout(coverTimer);
    coverTimer = null;
    if (coverPhase !== "on") return;
    requestAnimationFrame(() => requestAnimationFrame(() => coverPhase === "on" && coverStore.set("leaving")));
  },
};

type HeaderEntry = { node: React.ReactNode; focused: boolean; seq: number };
const headerEntries = new Map<string, HeaderEntry>();
const headerListeners = new Set<() => void>();
let headerSeq = 0;
let headerPending = false;
let headerSnapshot: React.ReactNode = null;
let headerHoldTimer: ReturnType<typeof setTimeout> | null = null;
const HEADER_HOLD_MS = 1500; // how long to hold the outgoing header before blanking
let isTallHeader: (node: React.ReactNode) => boolean = () => false;
export function setTallHeaderCheck(fn: (node: React.ReactNode) => boolean) {
  isTallHeader = fn;
}
function publishHeader() {
  let best: HeaderEntry | null = null;
  for (const e of headerEntries.values()) if (e.focused && (!best || e.seq > best.seq)) best = e;
  if (!headerPending && best) {
    if (headerHoldTimer) clearTimeout(headerHoldTimer);
    headerHoldTimer = null;
    headerSnapshot = best.node;
  } else if (headerSnapshot == null) {
    headerSnapshot = BLANK_HEADER;
  } else if (isTallHeader(headerSnapshot)) {
    // Leaving the Dashboard: collapse the hero immediately with the page slide, not after the next page renders.
    headerSnapshot = BLANK_HEADER;
  } else {
    // Hold the outgoing header during the focus gap so HeaderHost always sees real->real, never a blank flash.
    if (!headerHoldTimer) {
      headerHoldTimer = setTimeout(() => {
        headerHoldTimer = null;
        headerPending = false;
        let next: HeaderEntry | null = null;
        for (const e of headerEntries.values()) if (e.focused && (!next || e.seq > next.seq)) next = e;
        headerSnapshot = next ? next.node : BLANK_HEADER;
        headerListeners.forEach((l) => l());
      }, HEADER_HOLD_MS);
    }
    return;
  }
  headerListeners.forEach((l) => l());
}
export const headerStore = {
  get: () => headerSnapshot,
  set: (key: string, node: React.ReactNode, focused: boolean) => {
    const prev = headerEntries.get(key);
    const gained = focused && !prev?.focused;
    if (gained) {
      if (headerPending) coverStore.end();
      headerPending = false;
    }
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
  pending: () => {
    headerPending = true;
    coverStore.begin();
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

export const FAB_CAPTION_H = 18;
const FAB_MENU_W = 72;

export type FabMenuAction = {
  label: string;
  icon: string;
  onPress: () => void;
  active?: boolean;
  dot?: boolean;
};

type TabsNav = BottomTabBarProps["navigation"];
type TabsState = BottomTabBarProps["state"];
export const tabsRef: { nav: TabsNav | null; state: TabsState | null } = { nav: null, state: null };

let directSeq = 0;

// Tabs with their own stack (index + [id]); the rest are a single screen.
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
  "billing",
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

// Cross-tab jumps reset the tabs navigator in ONE dispatch (not visible-then-swap-stack) to avoid
// a flash of the target tab's old content before the destination renders.
export function openPage(path: string) {
  if (!canOpenPath(path)) {
    toast.error("Access denied", "You don't have permission to open this page.");
    return;
  }
  // Prefetch so the destination mounts with real header/body instead of placeholder-then-fill.
  const loading = prefetchPage?.(path);
  if (!loading) return navigateTo(path);
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    navigateTo(path);
  };
  loading.then(go, go);
  setTimeout(go, PREFETCH_WAIT_MS);
}

// Registered by the tabs layout; starts loading a path's page data, returns null if nothing to load.
let prefetchPage: ((path: string) => Promise<unknown> | null) | null = null;
export function setPagePrefetch(fn: typeof prefetchPage) {
  prefetchPage = fn;
}
const PREFETCH_WAIT_MS = 600; // longest a link waits for prefetch before opening anyway

function navigateTo(path: string) {
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
  // Target stack gets exactly ONE route (the destination), so its list is never created
  // underneath and isn't there for Back to land on; Back falls through to the tabs' history.
  if (!STACK_TABS.has(tab)) {
    focusTab(nav, state, targetIndex, { params });
    return;
  }
  focusTab(nav, state, targetIndex, { stack: { name: screen, params: screenParams } });
}

// Focus a tab and optionally reset its stack to one screen, via a single RESET on the tabs
// navigator (addressing the nested stack directly fails: its key isn't known until it reports back).
export function focusTab(
  nav: TabsNav,
  state: TabsState,
  targetIndex: number,
  change: { params?: object; stack?: { name: string; params?: object } }
) {
  const target = state.routes[targetIndex];
  // A stack change gives the tab route a NEW key, so a fresh scene mounts straight onto the
  // destination instead of the old stack's list flashing first.
  const n = change.stack ? ++directSeq : 0;
  const nextKey = change.stack ? `${target.name}-direct-${n}` : target.key;
  const routes = state.routes.map((r, i) => {
    if (i !== targetIndex) return r;
    if (change.stack) {
      return {
        ...r,
        key: nextKey,
        state: { type: "stack" as const, key: `direct-stack-${n}`, index: 0, routes: [{ key: `direct-${n}`, ...change.stack }] },
      };
    }
    return change.params ? { ...r, params: change.params } : r;
  });
  // A raw RESET wipes state.history unless we rebuild it (de-dupe + append), or Back after this
  // jump has nowhere to fall into and Android closes the app outright.
  const history = (state.history ?? [])
    .filter((it) => (it && typeof it === "object" && "key" in it ? it.key !== target.key && it.key !== nextKey : true))
    .concat({ type: "route" as const, key: nextKey });
  nav.dispatch({ type: "RESET", payload: { ...state, index: targetIndex, routes, history } });
}

const shadow = (y: number, blur: number, opacity: number, color = "43, 26, 94") => ({
  boxShadow: `0px ${y}px ${blur}px rgba(${color}, ${opacity})`,
});

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  headerShell: { zIndex: 20 },
  headerSpacer: { opacity: 0 },
  headerHost: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 30 },
  headerCurtain: { position: "absolute", top: 0, left: 0, right: 0 },
  heroClip: { borderBottomLeftRadius: 26, borderBottomRightRadius: 26, overflow: "hidden" },
  body: { flex: 1 },
  headerFade: { position: "absolute", top: 0, left: 0, right: 0 },

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

  fab: {
    position: "absolute",
    right: 16,
    zIndex: 45, // above the tab bar's fade (40), below the bar itself (50)
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: C.brandDeep,
    alignItems: "center",
    justifyContent: "center",
    ...shadow(10, 22, 0.3, "0, 0, 0"),
  },
  fabMenu: {
    position: "absolute",
    right: 42 - FAB_MENU_W / 2, // centred on the corner button (right 16 + 52/2)
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
  fabMenuIcOn: { backgroundColor: C.brand, borderWidth: 3, borderColor: C.brandPale },
  fabMenuDot: { position: "absolute", top: -2, right: -2, width: 11, height: 11, borderRadius: 6, backgroundColor: C.accent, borderWidth: 2, borderColor: C.card },
  fabMenuLbl: { marginTop: 5, fontSize: 11, fontWeight: "700", color: C.ink, textAlign: "center" },
  fabWrap: { position: "absolute", zIndex: 45, width: 52, alignItems: "center", overflow: "visible" },
  fabInline: { position: "relative", right: undefined },
  fabCaption: { width: 96, height: FAB_CAPTION_H, paddingTop: 4, fontSize: 11, fontWeight: "700", color: C.brandDeep, textAlign: "center" },

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
