import { useSafeAreaInsets } from "react-native-safe-area-context";

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
