import { Animated, BackHandler, Keyboard } from "react-native";
import { PAGE_WIDTH } from "@/common/theme/layout";
import { headerStore, resetTabs, tabsRef, withoutNestedTarget, type TabRoute, type tabRouteMinter } from "./shellContext";
import { PRIMARY_ROUTES, swipe, swipeSettled } from "./swipeStore";

const COMMIT_FRACTION = 0.2;
const COMMIT_VELOCITY = 300;
const MAX_VELOCITY = 8;
// Focusing the tab re-renders the navigator and every page (~250 ms of JS in dev). It waits until
// the user has stopped swiping for this long, so it never lands on top of the next swipe.
const FOCUS_IDLE_MS = 450;
const WIDTH = PAGE_WIDTH;

type Allowed = (route: string) => boolean;

// One swipe at a time, so plain module state is enough. `rest` is where the pages sat when the
// drag began (a whole page, or wherever an interrupted settle was stopped); `anim` tells the
// current settle from one that was interrupted.
const st = { fromIdx: -1, canNext: false, canPrev: false, running: false, settling: false, interrupted: false, rest: 0, anim: 0, allowed: (() => true) as Allowed };

// The page a swipe landed on while the navigator still has the old tab focused (its focus is
// deferred, see scheduleFocus), and the navigator's focused route key when that began.
let committedIdx = -1;
let committedFromKey: string | null = null;
let focusTimer: ReturnType<typeof setTimeout> | null = null;
let touching = false;
let backHooked = false;

// The drag itself runs on the native side: the gesture writes swipe.dragPx and the pages,
// tab bar and hero follow it without touching the JS thread. JS only hears about the touch,
// the start and the release, and nothing it does there is needed for the pages to follow the
// finger: the reachable neighbours are set up ahead of time (setGates).

/** The primary page on screen: the swiped-to one until the navigator has caught up. */
function currentIdx() {
  const state = tabsRef.state;
  const focused = state?.routes[state.index];
  const navIdx = focused ? PRIMARY_ROUTES.indexOf(focused.name) : -1;
  // Caught up, or something else navigated meanwhile (a tab tap, a link, a row): drop it.
  if (committedIdx >= 0 && (navIdx === committedIdx || focused?.key !== committedFromKey)) {
    committedIdx = -1;
    committedFromKey = null;
  }
  return committedIdx >= 0 ? committedIdx : navIdx;
}

/** Which neighbours of page `idx` a drag may reach. */
function setGates(idx: number) {
  const route = idx >= 0 ? tabsRef.state?.routes.find((r) => r.name === PRIMARY_ROUTES[idx]) : undefined;
  const nested = route?.state;
  const atRoot = !!route && (!nested || nested.type !== "stack" || (nested.index ?? 0) === 0);
  const next = PRIMARY_ROUTES[idx + 1];
  const prev = PRIMARY_ROUTES[idx - 1];
  Object.assign(st, { fromIdx: idx, canNext: atRoot && !!next && st.allowed(next), canPrev: atRoot && idx > 0 && st.allowed(prev) });
  swipe.canNext.setValue(st.canNext ? 1 : 0);
  swipe.canPrev.setValue(st.canPrev ? 1 : 0);
}

/** Touch down. A touch during a settle stops it where it is, and the drag carries on from there. */
export function swipeBegin(allowed: Allowed) {
  st.allowed = allowed;
  touching = true;
  if (focusTimer) clearTimeout(focusTimer);
  focusTimer = null;
  if (st.running) return;
  const idx = currentIdx();
  st.rest = idx;
  if (st.settling) {
    st.settling = false;
    st.interrupted = true;
    st.anim++;
    swipe.pos.stopAnimation((v) => {
      st.rest = v;
    });
    swipeSettled();
  }
  setGates(idx);
}

/** Ease the pages into page `target` from wherever `pos` is, then queue the tab focus. */
function settleTo(target: number, velocity: number) {
  const id = ++st.anim;
  st.settling = true;
  st.interrupted = false;
  swipe.page = target;
  Animated.spring(swipe.pos, { toValue: target, velocity, stiffness: 600, damping: 49, mass: 1, overshootClamping: true, restDisplacementThreshold: 0.005, restSpeedThreshold: 0.5, useNativeDriver: true }).start(() => {
    if (id !== st.anim) return;
    st.settling = false;
    swipeSettled();
    scheduleFocus();
  });
}

/** The drag has been claimed (it moved far enough, mostly sideways). */
export function swipeStart(velocityX: number) {
  if (!st.canNext && !st.canPrev) return;
  st.running = true;
  swipe.active = true;
  // Leaving a page closes its keyboard now; its (deferred) blur must not close one opened since.
  Keyboard.dismiss();
  // Translation is measured from here, so it is still ~0: the direction comes from the velocity.
  // The hero morph follows the drag, so the other page's header (its real title) must be
  // up from the first frame — not after the focus change lands.
  const dir = velocityX < 0 ? 1 : -1;
  if ((dir > 0 ? st.canNext : st.canPrev) && (st.fromIdx === 0 || st.fromIdx + dir === 0)) headerStore.preview(PRIMARY_ROUTES[st.fromIdx + dir]);
}

/** A touch that ended without becoming a swipe (a tap, a vertical scroll). */
export function swipeTouchEnd() {
  touching = false;
  // A tap that stopped a settle: finish it, rather than leave the pages between two.
  if (st.interrupted) settleTo(st.fromIdx, 0);
  else scheduleFocus();
}

export function swipeEnd(translationX: number, velocityX: number) {
  touching = false;
  if (!st.running) {
    swipe.dragPx.setValue(0);
    swipeTouchEnd();
    return;
  }
  st.running = false;
  const from = st.fromIdx;
  // Where the pages are on screen right now, as the native side computed it.
  const off = translationX < 0 ? (st.canNext ? Math.min(1, -translationX / WIDTH) : 0) : st.canPrev ? -Math.min(1, translationX / WIDTH) : 0;
  const at = st.rest + off;
  // A flick goes the way the finger was moving; a slow drag goes past COMMIT_FRACTION of a page.
  const flick = velocityX < -COMMIT_VELOCITY ? 1 : velocityX > COMMIT_VELOCITY ? -1 : 0;
  let target = flick ? from + flick : at - from > COMMIT_FRACTION ? from + 1 : from - at > COMMIT_FRACTION ? from - 1 : from;
  target = Math.max(st.canPrev ? from - 1 : from, Math.min(st.canNext ? from + 1 : from, target));

  const state = tabsRef.state;
  const navIdx = state ? PRIMARY_ROUTES.indexOf(state.routes[state.index].name) : -1;
  if (target === navIdx) {
    committedIdx = -1;
    committedFromKey = null;
  } else {
    if (committedIdx < 0) committedFromKey = state?.routes[state.index].key ?? null;
    committedIdx = target;
  }

  // Hand the finger's offset over to `pos` in one go so the pages don't move, then settle at
  // the finger's own speed (pages per second).
  swipe.pos.setValue(at);
  swipe.dragPx.setValue(0);
  setGates(target);
  settleTo(target, Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, -velocityX / WIDTH)));
  // After the animation commands above have gone to the native side: the header re-render this
  // triggers blocks the JS thread for ~60-90ms, and ran first it held the slide back that long.
  requestAnimationFrame(() => headerStore.preview(PRIMARY_ROUTES[target]));
}

/** Focus the swiped-to tab once the user has paused; a further touch postpones it again. */
function scheduleFocus() {
  if (focusTimer) clearTimeout(focusTimer);
  focusTimer = null;
  if (committedIdx < 0) return;
  if (!backHooked) {
    backHooked = true;
    // Registered after the navigator's own handler, so it runs first: Back must act on the page
    // that is on screen, not on the tab the navigator still has focused.
    BackHandler.addEventListener("hardwareBackPress", () => {
      flushFocus();
      return false;
    });
  }
  focusTimer = setTimeout(() => {
    focusTimer = null;
    if (!touching && !st.running && !st.settling) flushFocus();
  }, FOCUS_IDLE_MS);
}

let swipeFocusAt = 0;
/** Whether a page blurring now is one a swipe left a while ago (its keyboard was closed then). */
export function blurredBySwipe() {
  return Date.now() - swipeFocusAt < 1000;
}

/** A tab-bar tap replaces a swipe's waiting tab focus. Returns the page the swipe landed on, or -1. */
export function dropPendingFocus() {
  if (focusTimer) clearTimeout(focusTimer);
  focusTimer = null;
  const idx = currentIdx();
  const swiped = committedIdx >= 0 ? idx : -1;
  committedIdx = -1;
  committedFromKey = null;
  return swiped;
}

/** Focus the swiped-to tab now (Back needs the navigator on the page that is on screen). */
function flushFocus() {
  if (focusTimer) clearTimeout(focusTimer);
  focusTimer = null;
  const state = tabsRef.state;
  const target = committedIdx;
  if (!state || target < 0 || currentIdx() !== target) return;
  swipeFocusAt = Date.now();
  focusTab(PRIMARY_ROUTES.indexOf(state.routes[state.index].name), target);
}

// A tab left on a detail page (one opened from its list, or by a jump that holds only the
// detail) is put back on its list once it is off screen, so coming back to it — by swipe,
// Back or a tap — always lands on the list, with no flash of the old detail.
const STALE_RESET_MS = 600;
let staleTimer: ReturnType<typeof setTimeout> | null = null;

export const leftOnDetail = (r: TabRoute) => r.state?.type === "stack" && (r.state.routes?.[0]?.name !== "index" || (r.state.index ?? 0) > 0);

/** The tabs' routes with each tab named in `stale` given a fresh stack holding just its list
 * (new keys, so `replaced` lets the Back history follow). For resetTabs. */
function withListRoots(routes: TabRoute[], stale: string[], mint: ReturnType<typeof tabRouteMinter>) {
  const replaced = new Map<string, string>();
  const next = routes.map((r) => {
    if (!stale.includes(r.name)) return r;
    const fresh = mint.stackRoute(r.name, { name: "index" });
    replaced.set(r.key, fresh.key);
    const { path: _path, ...rest } = r;
    return { ...rest, key: fresh.key, params: withoutNestedTarget(r.params), state: fresh.state };
  });
  return { routes: next, replaced };
}

/** Called on every tab-state change; resets off-screen stale tabs once things are quiet. */
export function scheduleStaleRootReset() {
  if (staleTimer) clearTimeout(staleTimer);
  staleTimer = setTimeout(resetStaleRoots, STALE_RESET_MS);
}

function resetStaleRoots() {
  staleTimer = null;
  const { nav, state } = tabsRef;
  if (!nav || !state) return;
  // Not while a swipe is moving the pages (the off-screen tabs may be sliding into view).
  if (st.running || st.settling) return scheduleStaleRootReset();
  const stale = state.routes.filter((r, i) => i !== state.index && PRIMARY_ROUTES.indexOf(r.name) !== swipe.page && leftOnDetail(r)).map((r) => r.name);
  if (!stale.length) return;
  resetTabs(nav, (routes, mint) => ({ ...withListRoots(routes, stale, mint), focusKey: null }));
}

/** Focus a primary tab, resetting the one being left in the same dispatch if it is stale. */
function focusTab(fromIdx: number, toIdx: number) {
  const { nav, state } = tabsRef;
  if (!nav || !state) return;
  const to = state.routes.find((r) => r.name === PRIMARY_ROUTES[toIdx]);
  const left = state.routes.find((r) => r.name === PRIMARY_ROUTES[fromIdx]);
  if (!to || !left || !leftOnDetail(left)) {
    nav.navigate(PRIMARY_ROUTES[toIdx]);
    return;
  }
  const done = resetTabs(nav, (routes, mint) => {
    const reset = withListRoots(routes, [left.name], mint);
    const toKey = routes.find((r) => r.name === to.name)?.key;
    return { ...reset, focusKey: toKey ?? null };
  });
  if (!done) nav.navigate(PRIMARY_ROUTES[toIdx]);
}
