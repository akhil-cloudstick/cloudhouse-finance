import { Animated, Easing } from "react-native";
import { PAGE_WIDTH } from "@/common/theme/layout";

// Primary tab routes in bar order — the pages a horizontal swipe moves between.
export const PRIMARY_ROUTES = ["dashboard", "customers", "loans", "schemes"];

const WIDTH = PAGE_WIDTH;

const pos = new Animated.Value(0);
// The finger's horizontal travel, written by the native gesture itself (no JS in the loop).
const dragPx = new Animated.Value(0);
// 1 when a neighbouring primary page exists on that side and may be swiped to.
const canNext = new Animated.Value(0);
const canPrev = new Animated.Value(0);

const toNext = dragPx.interpolate({ inputRange: [-WIDTH, 0], outputRange: [1, 0], extrapolate: "clamp" });
const toPrev = dragPx.interpolate({ inputRange: [0, WIDTH], outputRange: [0, 1], extrapolate: "clamp" });
const drag = Animated.add(Animated.multiply(toNext, canNext), Animated.multiply(Animated.multiply(toPrev, canPrev), -1));

// The one position that places the four primary pages AND lights the tab bar,
// so they cannot drift apart: 1.4 = 40% of the way from Customers to Loans.
// Page i sits at (i - view) screen widths; tab i is lit by how close view is to i.
// `pos` is where the pages rest (a tap or a release animates it); `view` is
// `pos` plus the live finger drag, and is what everything reads.
export const swipe = {
  pos,
  dragPx,
  canNext,
  canPrev,
  view: Animated.add(pos, drag),
  // True from the first drag frame until the release has settled.
  active: false,
  // The page `pos` is resting on (or heading to).
  page: 0,
};

/** Bring primary page `idx` on screen for a tab tap or any navigation: a neighbour slides in,
 * a page further away appears at once instead of sliding every page in between across. */
export function showPage(idx: number) {
  const far = Math.abs(idx - swipe.page) > 1;
  swipe.page = idx;
  if (far) {
    swipe.pos.stopAnimation();
    swipe.pos.setValue(idx);
  } else {
    Animated.timing(swipe.pos, { toValue: idx, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }
}

// Built once per primary page and reused: creating these in a render (the tab bar and the tab
// navigator re-render on every tab change) re-creates and re-attaches native animation nodes
// while the pages are still moving.
const byPage = <T>(make: (i: number) => T) => PRIMARY_ROUTES.map((_, i) => make(i));
/** Page i's horizontal offset: it sits at (i - view) screen widths. */
export const pageShift = byPage((i) => swipe.view.interpolate({ inputRange: [i - 1, i, i + 1], outputRange: [WIDTH, 0, -WIDTH] }));
/** 1 while tab i is the (fractional) active one, fading out a full tab away. */
export const tabLit = byPage((i) => swipe.view.interpolate({ inputRange: [i - 1, i, i + 1], outputRange: [0, 1, 0], extrapolate: "clamp" }));
export const tabScale = byPage((i) => swipe.view.interpolate({ inputRange: [i - 1, i, i + 1], outputRange: [1, 1.06, 1], extrapolate: "clamp" }));

const settleWaiters = new Set<() => void>();
/** Runs `fn` once the current swipe has settled (at once if none is under way). */
export function whenSwipeSettled(fn: () => void) {
  if (!swipe.active) return fn();
  settleWaiters.add(fn);
}
export function swipeSettled() {
  swipe.active = false;
  const fns = [...settleWaiters];
  settleWaiters.clear();
  fns.forEach((f) => f());
}
