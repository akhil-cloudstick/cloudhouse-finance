import { createContext, useContext } from "react";
import { Dimensions, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Tablets: the shortest side of the physical screen is >= 600dp (the same
// cut-off Android uses). It never changes with rotation. Phones are locked to
// portrait (see RootLayout) and lay out exactly as before.
const SCREEN = Dimensions.get("screen");
export const IS_TABLET = Math.min(SCREEN.width, SCREEN.height) >= 600;
// On a tablet the whole app (pages, tab bar, sheets, toasts) lives in one
// centred column no wider than this, in either orientation, so every phone
// layout keeps working unchanged inside it.
export const COLUMN_MAX = 900;
// The column fills the window (landscape iPads included: tables spread over the
// full width instead of leaving empty sides) up to this; only bigger windows
// (desktop browsers) are centred with margins.
export const COLUMN_HARD_MAX = 1400;

/** Column width for a given window width. Phones/narrow windows: the full window. */
export function columnWidthFor(w: number) {
  return Math.min(w, COLUMN_HARD_MAX);
}
/** Page offset used by the tab-swipe maths. It is read once, so on a tablet it is the widest the column can get (rotation can only shrink it); a phone is portrait-only. */
export const PAGE_WIDTH = IS_TABLET ? COLUMN_HARD_MAX : Dimensions.get("window").width;

/** Runs `cb` whenever the window changes size (rotation, split view, browser resize). Module-level
 * layout caches use it to forget measurements taken in the other orientation. */
export function onWindowSizeChange(cb: () => void) {
  return Dimensions.addEventListener("change", cb);
}

/** The app column's current width: what the root view measured, else derived from the live window. */
/** The app column's width as actually laid out (set by the root layout). After a rotation the window size
 * the system reports can lag or stay stale, which left tables laid out for the wrong width and running off
 * the screen; what the view really measured never does. */
export const MeasuredColumnWidth = createContext<number | null>(null);

export function useColumnWidth() {
  const measured = useContext(MeasuredColumnWidth);
  const win = useWindowDimensions().width;
  return measured ?? columnWidthFor(win);
}

// The bottom tab bar floats over every tab screen (see AppTabBar): a fade
// zone above the white bar, then the bar itself, then the gesture inset.
export const TAB_BAR_FADE = 72;
export const TAB_BAR_HEIGHT = 70;
// Static bottom space for lists that can't use a hook: fade + bar + a typical
// gesture inset, so the last row clears the bar.
export const TAB_BAR_SPACE = TAB_BAR_FADE + TAB_BAR_HEIGHT + 24;

/** Bottom space for forms/detail pages: just clears the white bar itself (the
 * last control may sit in the fade zone), so there's no big gap below a
 * page's final button. */
export function useTabBarClearance() {
  return TAB_BAR_HEIGHT + useSafeAreaInsets().bottom + 16;
}

// FloatingHeader: marginTop (8) + island (8 + 30 avatar + 8 padding + 2 border).
const HEADER_BELOW_INSET = 56;

/** Height of the floating header from the screen top (status bar included).
 * The header floats over the scene (headerTransparent), so ScreenContainer
 * pads its top by this, and scrollers extend back up under the header by the
 * same amount so content can scroll behind it and fade out. */
export function useHeaderSpace() {
  return useSafeAreaInsets().top + HEADER_BELOW_INSET;
}

// ---- Prototype (ui-demos/staff-app-prototype.html) shell metrics ----
// .tabbar: left/right/bottom 14, height 70, radius 26.
export const PTAB_INSET = 14;
export const PTAB_HEIGHT = 70;
// .tabfade: 88 tall, transparent → bg, solid from 65%.
export const PTAB_FADE = 88;
// .content: padding-bottom 110 so the last row clears the floating bar.
export const PCONTENT_BOTTOM = 110;
// Single canonical horizontal gutter (.table-container / .card margins).
export const PGUTTER = 18;
// Smooth fade under every header so content scrolls away gradually.
export const PHEADER_FADE = 28;

/** Bottom padding for a scroller under the prototype tab bar. */
export function usePContentBottom(extra = 0) {
  return PCONTENT_BOTTOM + useSafeAreaInsets().bottom + extra;
}

/** How far the floating tab bar (and everything positioned relative to it —
 * page end padding, FABs, action bars, the fade) rises for the device's
 * bottom safe-area inset. The bar's own PTAB_INSET margin is absorbed into
 * the inset rather than stacked on top of it: stacking put the bar 14px
 * above a 34px home indicator / 48px 3-button nav bar, leaving a tall
 * empty strip under it (and a matching extra gap at every page's end) on
 * exactly the devices with the biggest insets. The bar never goes below the
 * inset, so it still clears the system navigation. */
// Gap kept between the floating bar and the system navigation (buttons / gesture bar) when there is one.
const SYSTEM_NAV_GAP = 8;
export function tabBarLift(insetBottom: number) {
  return insetBottom > 0 ? Math.max(insetBottom - PTAB_INSET + SYSTEM_NAV_GAP, 0) : 0;
}

/** From this column width up (iPad mini portrait and bigger) list rows are drawn as a table instead of cards. */
export const TABLE_MIN_WIDTH = 700;
