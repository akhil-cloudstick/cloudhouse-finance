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
