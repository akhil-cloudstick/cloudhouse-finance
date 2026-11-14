import type { LoanDraft } from "@/modules/loans/types/loan-types";
import type { Customer } from "@/modules/customers/types/customer-types";
import React, { createContext, useContext } from "react";
import { Animated, StyleSheet } from "react-native";
import { router as globalRouter } from "expo-router";
import { C } from "./base";
import { PTAB_HEIGHT, PTAB_INSET } from "@/common/theme/layout";
import { canOpenPath } from "@/common/config/routePermissions";
import { toast } from "./ToastHost";

// ---------------------------------------------------------------------------
// Shell actions — one set of global openers (New Loan sheet, More sheet,
// search, gold rate, reminders) provided by app/(tabs)/_layout.tsx so every
// header / quick action drives the same sheet instance.
// ---------------------------------------------------------------------------
export type ShellActions = {
  openNewLoan: () => void;
  /** New Loan with this customer already picked (from the customer page). */
  openNewLoanFor: (customer: Customer) => void;
  /** New Loan sheet with a saved draft loaded (from the Loans screen's Draft loans list). */
  openNewLoanDraft: (draft: LoanDraft) => void;
  openMore: () => void;
  openSearch: () => void;
  openGoldRate: () => void;
  openReminders: () => void;
  openProfile: () => void;
  /** Collect Payment for a loan, right over the current page. */
  openCollect: (loanId: number) => void;
  /** Register Customer, right over the current page (like New Loan); opens the new profile after saving. */
  openRegisterCustomer: () => void;
};
const noop = () => {};
export const ShellContext = createContext<ShellActions>({
  openNewLoan: noop,
  openNewLoanFor: noop,
  openNewLoanDraft: noop,
  openMore: noop,
  openSearch: noop,
  openGoldRate: noop,
  openReminders: noop,
  openProfile: noop,
  openCollect: noop,
  openRegisterCustomer: noop,
});
export const useShell = () => useContext(ShellContext);

/** Shown for the moment between leaving a page and the next one drawing. Handed in by HeaderHost
 * (a blank FlatHeader) — importing FlatHeader here made a require cycle, as FlatHeader imports this file. */
let BLANK_HEADER: React.ReactNode = null;
export function setBlankHeader(node: React.ReactNode) {
  BLANK_HEADER = node;
}

/** Set by HeaderHost while the hero collapses into (or grows back out of) a
 * page's flat header. `p` runs 0 (hero open) → 1 (collapsed to the flat
 * header's height); `lift` is the height difference between the two. */
export type HeroMorph = { p: Animated.AnimatedInterpolation<number>; lift: Animated.Value };
export const HeroMorphContext = createContext<HeroMorph | null>(null);

/** Set by HeaderHost while a flat header's title is changing: the outgoing text and the 0 → 1
 * fade (`out` is its mirror). FlatHeader cross-fades just its title block with it. */
export type TitleTransition = { prev: { title: string; subtitle?: string }; fade: Animated.Value; out: Animated.AnimatedInterpolation<number> };
export const TitleTransitionContext = createContext<TitleTransition | null>(null);

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
// NavCover (drawn by the tab bar, over the pages and under the header / bar)
// hides the body from the moment an openPage() jump starts until the
// destination has drawn, then fades away — so the header morph and the new
// page arrive together instead of the page showing under the old header.
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

/** Height of a page's header when the page lets its content run under it (Screen `overlayHeader`) —
 * a scroller inside pads its content by this much (PScroll `underHeader`). 0 otherwise. */
export const HeaderInsetContext = createContext(0);

/** Which tab (route name) a page belongs to, so its header can be found before the page is focused. */
export const TabNameContext = createContext("");

type HeaderEntry = { node: React.ReactNode; focused: boolean; seq: number; tab: string };
const headerEntries = new Map<string, HeaderEntry>();
const headerListeners = new Set<() => void>();
let headerSeq = 0;
let headerPending = false;
// The tab an openPage() jump is heading to, until the destination takes focus. The jump itself runs
// two frames after the header starts changing, so until then the navigator still reports the page
// being left — HeaderHost reads this instead to know whether the destination is a primary tab.
let pendingTab = "";
export const jumpTarget = () => pendingTab;
let headerSnapshot: React.ReactNode = null;
let headerHoldTimer: ReturnType<typeof setTimeout> | null = null;
// The tab whose header preview() put up ahead of its focus ("" when none), and the safety timer.
let previewTab = "";
let previewTimer: ReturnType<typeof setTimeout> | null = null;
// Covers the swipe's deferred tab focus (swipeController's FOCUS_IDLE_MS after the slide settles).
// A real focus change ends the hold at once (endPreview), so this is only a safety net.
const PREVIEW_HOLD_MS = 8000;
function endPreview() {
  previewTab = "";
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = null;
}
// How long the outgoing header is held for a page that never reports focus
// (one not built on <Screen>) before giving up and blanking. Same budget as
// the NavCover's own safety timeout.
const HEADER_HOLD_MS = 1500;
// Set by HeaderHost: whether a header node is the Dashboard hero (the tall one).
let isTallHeader: (node: React.ReactNode) => boolean = () => false;
export function setTallHeaderCheck(fn: (node: React.ReactNode) => boolean) {
  isTallHeader = fn;
}
function publishHeader() {
  let best: HeaderEntry | null = null;
  for (const e of headerEntries.values()) if (e.focused && (!best || e.seq > best.seq)) best = e;
  if (!headerPending && best) {
    // A previewed tab's header stays up until that tab takes focus — the page being left is
    // still "focused" for a moment and re-publishes on every render, which flipped the title back.
    if (previewTab) {
      if (best.tab !== previewTab) return;
      previewTab = "";
    }
    if (headerHoldTimer) clearTimeout(headerHoldTimer);
    headerHoldTimer = null;
    headerSnapshot = best.node;
  } else if (headerSnapshot == null) {
    headerSnapshot = BLANK_HEADER;
  } else if (isTallHeader(headerSnapshot)) {
    // Leaving the Dashboard: every other page has a flat header, so start the hero's collapse
    // now — together with the page slide — instead of holding the hero until the next page has
    // rendered (a heavy page kept it on screen well after the slide had finished). The page's
    // own title lands on the collapsing flat header as soon as it reports focus.
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
        pendingTab = "";
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
  set: (key: string, node: React.ReactNode, focused: boolean, tab = "") => {
    const prev = headerEntries.get(key);
    const gained = focused && !prev?.focused;
    if (gained) {
      if (headerPending) coverStore.end();
      headerPending = false;
      pendingTab = "";
      // A page really took focus: whatever preview was up has served its purpose.
      endPreview();
    }
    headerEntries.set(key, { node, focused, tab, seq: gained ? ++headerSeq : (prev?.seq ?? 0) });
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
   * takes focus (see publishHeader). `tab` is where the jump is going. */
  pending: (tab = "") => {
    endPreview();
    headerPending = true;
    pendingTab = tab;
    coverStore.begin();
    publishHeader();
  },
  /** Show a primary tab's header now, from the copy its (already mounted) page last
   * published, instead of waiting for that page to take focus. */
  preview: (routeName: string) => {
    let e: HeaderEntry | undefined;
    for (const x of headerEntries.values()) if (x.tab === routeName && (!e || x.seq > e.seq)) e = x;
    if (!e) return;
    previewTab = routeName;
    if (previewTimer) clearTimeout(previewTimer);
    // Never hold a preview for a tab that doesn't end up focused: let the focused page's header back.
    previewTimer = setTimeout(() => {
      endPreview();
      publishHeader();
    }, PREVIEW_HOLD_MS);
    if (headerSnapshot === e.node) return;
    headerSnapshot = e.node;
    headerListeners.forEach((l) => l());
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
// Expo Router 58 types the tab bar's `state` as just { index, routes } and no longer hands it a
// `navigation`. At runtime the state is still the tab router's full state (its key, the
// `history` and each tab's nested stack state), which is what the helpers below rely on.
type NestedState = {
  type?: string;
  key?: string;
  index?: number;
  routes?: { key: string; name: string; params?: object; state?: NestedState }[];
};
export type TabsState = {
  key: string;
  index: number;
  routes: { key: string; name: string; params?: object; path?: string; state?: NestedState }[];
  history?: { type: string; key: string }[];
  /** Expo Router's counter for the next route key it mints in this navigator. */
  routeKeySeq?: number;
};

// Used only if the tabs state ever comes without its counter (the tab bar's trimmed fallback).
let fallbackSeq = 100000;

/**
 * Mints fresh tab routes for a RESET the way Expo Router mints its own, so the payload looks
 * router-made. Its keys are `<name>:<chain>` — the chain after the ":" is the route's place in
 * the tree (`<tabs chain>-<seq>`, from the tabs state's own `routeKeySeq`), and a navigator nested
 * under the route is keyed `navigator:<chain>`, its first route `<screen>:<chain>-0`. Hand-made
 * keys without that ":" made Expo Router warn on every lookup ("has no chain separator").
 * Pass `seq` back as the payload's `routeKeySeq` so the router carries on after them.
 */
export function tabRouteMinter(state: TabsState) {
  // The tab bar's own state has no key / counter; the navigation tree's copy (read now, so it's
  // current) does. Without either, fall back to a unique chain of our own — never a crash.
  const live = tabsRef.live?.();
  const stateKey = live?.key ?? state.key;
  const tabsChain = typeof stateKey === "string" ? (stateKey.startsWith("navigator:") ? stateKey.slice("navigator:".length) : stateKey) : null;
  let seq = live?.routeKeySeq ?? state.routeKeySeq ?? ++fallbackSeq;
  return {
    /** A new key for tab `name`, with a stack holding just `screen`. */
    stackRoute(name: string, screen: { name: string; params?: object }) {
      const chain = tabsChain === null ? `x${seq}` : tabsChain === "root" ? `${seq}` : `${tabsChain}-${seq}`;
      seq += 1;
      return {
        key: `${name}:${chain}`,
        state: { type: "stack" as const, key: `navigator:${chain}`, index: 0, routeKeySeq: 1, routes: [{ key: `${screen.name}:${chain}-0`, ...screen }] },
      };
    },
    /** A new key for a tab route with no stack of its own. */
    routeKey(name: string) {
      const chain = tabsChain === null ? `x${seq}` : tabsChain === "root" ? `${seq}` : `${tabsChain}-${seq}`;
      seq += 1;
      return `${name}:${chain}`;
    },
    get seq() {
      return seq;
    },
  };
}

export type TabRoute = TabsState["routes"][number];
type TabsEdit = { routes: TabRoute[]; focusKey: string | null; replaced?: Map<string, string> };

/**
 * RESETs the tabs navigator. Expo Router 58 only accepts a COMPLETE state here (`key`, `index`,
 * `routeNames`, `routeKeySeq`, `stale: false`) and ignores anything else — every jump built from
 * the tab bar's trimmed state was dropped ("The action 'RESET' … was not handled"). So the payload
 * is built from the navigator's own state in the navigation tree: `edit` changes its routes,
 * `focusKey` is the route to focus (null keeps the current one) and `replaced` maps old route keys
 * to their new ones so the Back history follows. Returns false if that state isn't available.
 */
export function resetTabs(nav: TabsNav, edit: (routes: TabRoute[], mint: ReturnType<typeof tabRouteMinter>) => TabsEdit): boolean {
  const live = tabsRef.live?.();
  if (!live) return false;
  const mint = tabRouteMinter(live);
  const edited = edit(live.routes, mint);
  const { focusKey, replaced } = edited;
  // A tab we aren't changing keeps its stack in `state`, which is the truth. Its params may still
  // carry the nested target (`screen`/`params`) of an earlier push or tab press; re-sent in this RESET
  // the stack followed it again on refocus — e.g. Back to a loan's detail, which then flipped to the list.
  const routes = edited.routes.map((r) => (r.state && r.params ? { ...r, params: withoutNestedTarget(r.params) } : r));
  const keep = live.routes[live.index]?.key ?? "";
  const focus = focusKey ?? replaced?.get(keep) ?? keep;
  const remap = (key: string) => replaced?.get(key) ?? key;
  let history = (live.history ?? []).map((it) => ({ ...it, key: remap(it.key) })).filter((it) => routes.some((r) => r.key === it.key));
  if (focusKey) history = history.filter((it) => it.key !== focusKey).concat({ type: "route", key: focusKey });
  nav.dispatch({
    type: "RESET",
    target: live.key,
    payload: { ...live, stale: false, routes, index: Math.max(0, routes.findIndex((r) => r.key === focus)), history, routeKeySeq: mint.seq },
  });
  return true;
}
/** What the tab bar can still do: dispatch to the tabs navigator, and focus one of its tabs. */
export type TabsNav = {
  dispatch: (action: { type: string; payload?: object; target?: string }) => void;
  navigate: (name: string) => void;
};
export const tabsRef: { nav: TabsNav | null; state: TabsState | null; live?: () => TabsState | undefined } = { nav: null, state: null };

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
  // Fetch the destination's data first (briefly), so it mounts with its real header and
  // body at once instead of a placeholder header + spinner that then fills in.
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

// Registered by the tabs layout (it holds the query client): starts loading what a path's page
// needs and returns the promise, or null when nothing needs loading (already cached / no data).
let prefetchPage: ((path: string) => Promise<unknown> | null) | null = null;
export function setPagePrefetch(fn: typeof prefetchPage) {
  prefetchPage = fn;
}
// Longest a link waits for that data before opening the page anyway (it then loads in place).
const PREFETCH_WAIT_MS = 600;

function navigateTo(path: string) {
  const { nav, state } = tabsRef;
  const { tab, id, params } = parsePath(path);
  const targetIndex = state?.routes.findIndex((r) => r.name === tab) ?? -1;
  const target = targetIndex >= 0 ? state?.routes[targetIndex] : undefined;
  const current = state?.routes[state?.index ?? -1]?.name;
  if (!nav || !state || current === tab) {
    globalRouter.push(path as never);
    return;
  }
  if (!target) {
    // A More page not opened yet this session. Expo Router 58 keeps only visited tabs in the
    // navigator's state, so there is no route to RESET onto — the router creates it. That first
    // mount is heavy and used to run with nothing on screen (blank page, no spinner): put the
    // cover + spinner up first, and push two frames later so it paints before the mount starts.
    headerStore.pending(tab);
    requestAnimationFrame(() => requestAnimationFrame(() => globalRouter.push(path as never)));
    return;
  }
  headerStore.pending(tab);
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
  // The jump waits two frames, so the cover (and its spinner, started by pending() above) is
  // on screen before the destination's first render takes over the JS thread. Run at once, that
  // render blocked the cover from ever painting and the screen sat blank until it finished.
  const jump = () => {
    const live = tabsRef;
    const idx = live.state?.routes.findIndex((r) => r.name === tab) ?? -1;
    if (!live.nav || !live.state || idx < 0) return;
    if (!STACK_TABS.has(tab)) {
      focusTab(live.nav, live.state, idx, { params });
      return;
    }
    focusTab(live.nav, live.state, idx, { stack: { name: screen, params: screenParams } });
  };
  requestAnimationFrame(() => requestAnimationFrame(jump));
}

/**
 * A tab route's params without the nested navigation they carry. Opening a page inside a tab
 * (router.push('/loans/288')) leaves `{ screen: "[id]", params: { id } }` on the tab route; a
 * stack handed a new state keeps those, and a freshly mounted stack follows them — re-opening
 * that old detail right after the tab was reset to its list.
 */
export function withoutNestedTarget(params: object | undefined) {
  if (!params) return params;
  const { screen: _screen, params: _params, initial: _initial, state: _state, path: _path, ...rest } = params as Record<string, unknown>;
  return rest;
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
  const name = state.routes[targetIndex]?.name;
  if (!name) return;
  // Built from the navigator's complete state (resetTabs). The target tab may not be in it yet
  // (a More page never opened) — then it is added.
  const done = resetTabs(nav, (routes, mint) => {
    const existing = routes.find((r) => r.name === name);
    let next: TabRoute;
    if (change.stack) {
      // A stack change also gives the tab route a NEW key. The tab's scene is keyed by it, so the
      // old stack (still showing its list — tabs like Loans are mounted up front) is dropped and
      // a fresh one mounts straight onto the destination. Handing the new state to the
      // already-mounted stack instead only took effect a render later, so the list was drawn
      // first and the detail landed over it.
      const m = mint.stackRoute(name, change.stack);
      const { path: _path, ...rest } = existing ?? { name };
      next = { ...rest, name, key: m.key, params: withoutNestedTarget(existing?.params), state: m.state };
    } else if (existing) {
      next = change.params ? { ...existing, params: change.params } : existing;
    } else {
      next = { name, key: mint.routeKey(name), ...(change.params ? { params: change.params } : {}) };
    }
    // The Back history (backBehavior="history") follows the tab: its old key is replaced by the
    // new one and it becomes the latest entry — without it, Back from a page opened this way had
    // nothing to fall back to and Android closed the app.
    return {
      routes: existing ? routes.map((r) => (r === existing ? next : r)) : [...routes, next],
      focusKey: next.key,
      replaced: existing && existing.key !== next.key ? new Map([[existing.key, next.key]]) : undefined,
    };
  });
  if (!done) nav.navigate(name);
}

// Height of a header's top row (logo + title / name + icons) — the same in every header, so the logo
// sits at the same spot on every page. Fits the 38px logo and either header's two-line text.
const HEADER_ROW_H = 40;

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
  // Same corner as the Dashboard hero (aHeader / heroClip), so the two headers match when they meet.
  flatHeader: { paddingHorizontal: 18, paddingBottom: 14, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, overflow: "hidden", backgroundColor: C.nav },
  // Fixed row height, shared with the Dashboard hero's top row (aTopRow): the row used to take the
  // height of its text, which differs between the two headers, so the logo sat a little lower in one.
  flatTopRow: { flexDirection: "row", alignItems: "center", gap: 8, height: HEADER_ROW_H },
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
  aTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: HEADER_ROW_H },
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
  tabIcOverlay: { alignItems: "center", justifyContent: "center" },
  tabLbl: { fontSize: 11.5, fontWeight: "600", color: C.muted },
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
