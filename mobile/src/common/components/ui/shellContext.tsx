import React, { createContext, useContext } from "react";
import { Animated, StyleSheet } from "react-native";
import { router as globalRouter } from "expo-router";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { C } from "./base";
import { PTAB_HEIGHT, PTAB_INSET } from "@/common/theme/layout";
import { canOpenPath } from "@/common/config/routePermissions";
import { toast } from "./ToastHost";
import { FlatHeader } from "./FlatHeader";

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

/** Shown for the moment between leaving a page and the next one drawing. */
const BLANK_HEADER = <FlatHeader title="" />;

/** Set by HeaderHost while the hero collapses into (or grows back out of) a
 * page's flat header. `p` runs 0 (hero open) → 1 (collapsed to the flat
 * header's height); `lift` is the height difference between the two. */
export type HeroMorph = { p: Animated.Value; lift: Animated.Value };
export const HeroMorphContext = createContext<HeroMorph | null>(null);

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
// looking pages up in it left the header blank. Between a page blurring (or
// openPage() starting a jump) and the next one taking focus, the outgoing
// header is HELD rather than blanked — see publishHeader — so the header is
// never seen empty mid-switch; NavCover hides the body during that gap.
// ---------------------------------------------------------------------------
// A page opened across tabs (openPage) reveals its tab first: that tab's
// native stack still shows whatever it was left on (its list) for a frame or
// two before the destination (e.g. a loan's detail) replaces it, which read
// as the list loading first and the detail after. NavCover (drawn by the tab
// bar, over the pages and under the header / bar) hides that gap from the
// moment the jump starts until the destination has drawn, then fades away.
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
    // Never leave the page covered if the destination fails to report in.
    coverTimer = setTimeout(coverStore.end, 1500);
  },
  /** The destination has taken focus: give its native screen two frames to
   * draw, then fade the cover away. */
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
// How long the outgoing header is held for a page that never reports focus
// (one not built on <Screen>) before giving up and blanking. Same budget as
// the NavCover's own safety timeout.
const HEADER_HOLD_MS = 1500;
function publishHeader() {
  let best: HeaderEntry | null = null;
  for (const e of headerEntries.values()) if (e.focused && (!best || e.seq > best.seq)) best = e;
  if (!headerPending && best) {
    if (headerHoldTimer) clearTimeout(headerHoldTimer);
    headerHoldTimer = null;
    headerSnapshot = best.node;
  } else if (headerSnapshot == null) {
    headerSnapshot = BLANK_HEADER;
  } else {
    // Between pages — the old one has blurred (or openPage() has started a
    // jump) and the new one hasn't reported focus yet. That gap is a frame or
    // more: the destination is frozen (freezeOnBlur) until it re-renders. It
    // used to publish BLANK_HEADER here, so every page switch showed the
    // header empty for that gap — the Dashboard hero blinking out — and the
    // tall→short curtain in HeaderHost then animated toward the BLANK
    // header's height before the real header's text popped in on top. Holding
    // the outgoing header instead means HeaderHost only ever sees real
    // header → real header, and its curtain runs once, to the right height.
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
  /** A page switch is under way: hold the current header until the next page
   * takes focus (see publishHeader). */
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

/** One corner button that opens upward into a panel of actions (like a
 * phone's side-panel launcher): closed it's a round chevron button; tapped,
 * a rounded panel rises out of it listing each action as an icon with its
 * name, and the chevron turns to fold it back. Tapping outside or picking
 * an action closes it. */
export type FabMenuAction = {
  label: string;
  icon: string;
  onPress: () => void;
  /** Highlights the item — when the menu switches what the page shows, the one on screen. */
  active?: boolean;
  /** Small gold dot on the item, e.g. unsaved changes there. */
  dot?: boolean;
};

// ---------------------------------------------------------------------------
// Cross-page navigation
// ---------------------------------------------------------------------------
type TabsNav = BottomTabBarProps["navigation"];
type TabsState = BottomTabBarProps["state"];
export const tabsRef: { nav: TabsNav | null; state: TabsState | null } = { nav: null, state: null };

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
  // Every quick link, KPI tile and hyperlink lands here — refuse a page the
  // user can't view (src/common/config/routePermissions.ts) instead of opening it
  // onto a screen of 403s.
  if (!canOpenPath(path)) {
    toast.error("Access denied", "You don't have permission to open this page.");
    return;
  }
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
export function focusTab(
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

const shadow = (y: number, blur: number, opacity: number, color = "43, 26, 94") => ({
  boxShadow: `0px ${y}px ${blur}px rgba(${color}, ${opacity})`,
});

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  headerShell: { zIndex: 20 },
  headerSpacer: { opacity: 0 },
  headerHost: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 30 },
  // Same rounded bottom as the hero (aHeader) it stands in for.
  headerCurtain: { position: "absolute", top: 0, left: 0, right: 0 },
  // The hero's rounded bottom, on the clip whose edge rises / drops.
  heroClip: { borderBottomLeftRadius: 26, borderBottomRightRadius: 26, overflow: "hidden" },
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
  fabMenuIcOn: { backgroundColor: C.brand, borderWidth: 3, borderColor: C.brandPale },
  fabMenuDot: { position: "absolute", top: -2, right: -2, width: 11, height: 11, borderRadius: 6, backgroundColor: C.accent, borderWidth: 2, borderColor: C.card },
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
