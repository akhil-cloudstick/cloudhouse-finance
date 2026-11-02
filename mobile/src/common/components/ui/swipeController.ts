import { Animated, Easing } from "react-native";
import { tabsRef } from "./shellContext";
import { PRIMARY_ROUTES, swipe } from "./swipeStore";

const COMMIT_FRACTION = 0.3;
const COMMIT_VELOCITY = 500;
const SETTLE_MS = 240;

// One swipe at a time, so plain module state is enough.
const st = { dir: 0, fromIdx: -1, toIdx: -1, frac: 0, running: false, navigated: false };

// Pages are positioned from swipe.pos alone (see TabsLayout), so a swipe never
// touches the navigator until the release: drag = write pos, release = animate
// pos and, on commit, focus the new tab.
export function swipeUpdate(translationX: number, width: number, allowed: (route: string) => boolean) {
  const { state } = tabsRef;
  if (!state) return;
  if (!st.running) {
    if (swipe.active) return;
    const route = state.routes[state.index];
    const fromIdx = PRIMARY_ROUTES.indexOf(route.name);
    const nested = route.state;
    const atRoot = !nested || nested.type !== "stack" || (nested.index ?? 0) === 0;
    const dir = translationX < 0 ? 1 : -1;
    const toRoute = PRIMARY_ROUTES[fromIdx + dir];
    if (fromIdx < 0 || !atRoot || !toRoute || !allowed(toRoute)) return;
    Object.assign(st, { running: true, dir, fromIdx, toIdx: fromIdx + dir, frac: 0, navigated: false });
    swipe.active = true;
  }
  const moved = st.dir > 0 ? Math.max(0, -translationX) : Math.max(0, translationX);
  st.frac = Math.min(1, moved / width);
  swipe.pos.setValue(st.fromIdx + st.dir * st.frac);
}

export function swipeEnd(velocityX: number) {
  if (!st.running) return;
  st.running = false;
  const commit = st.frac > COMMIT_FRACTION || -velocityX * st.dir > COMMIT_VELOCITY;
  const target = commit ? st.toIdx : st.fromIdx;
  Animated.timing(swipe.pos, { toValue: target, duration: SETTLE_MS * (0.6 + 0.4 * (commit ? 1 - st.frac : st.frac)), easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => {
    swipe.active = false;
  });
  // Focus (and the header morph) starts a frame after the slide, so the heavy
  // page render never lands mid-drag or stalls the native-driven slide.
  requestAnimationFrame(() => focusTab(commit));
}

function focusTab(toTarget: boolean) {
  if (st.navigated === toTarget) return;
  st.navigated = toTarget;
  tabsRef.nav?.navigate(PRIMARY_ROUTES[toTarget ? st.toIdx : st.fromIdx]);
}

/** Whether a horizontal drag in this direction has a neighbouring primary page to go to. */
export function swipeCanStart(dx: number, allowed: (route: string) => boolean) {
  if (st.running || swipe.active) return false;
  const state = tabsRef.state;
  const route = state?.routes[state.index];
  if (!route) return false;
  const nested = route.state;
  if (nested && nested.type === "stack" && (nested.index ?? 0) > 0) return false;
  const to = PRIMARY_ROUTES[PRIMARY_ROUTES.indexOf(route.name) + (dx < 0 ? 1 : -1)];
  return PRIMARY_ROUTES.indexOf(route.name) >= 0 && !!to && allowed(to);
}
