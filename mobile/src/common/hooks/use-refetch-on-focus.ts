import { useCallback, useLayoutEffect, useRef } from "react";
import { useFocusEffect } from "expo-router";

// React Query's `refetchOnWindowFocus` (on by default) only fires off a
// browser 'visibilitychange' event — there's no such thing in React Native,
// so a query only ever refetches on its FIRST mount. Once a tab's screen has
// been visited once, react-navigation keeps it mounted for the rest of the
// session (that's what makes switching tabs instant); navigating back to it
// is a focus, not a fresh mount, so nothing tells the query to go check the
// backend again — it just keeps showing whatever it fetched the first time.
// That's why an approval done on the web admin, then viewed on an
// already-visited mobile screen, kept showing the old status.
//
// Re-fires every given `refetch` every time the screen regains focus (tab
// switch, or navigating back from a detail screen) — the RN equivalent of
// window focus. Pass the `refetch` function(s) a `useQuery`/
// `useInfiniteQuery` call returns; a screen with several independent
// queries just lists all of them.
//
// The FIRST focus is skipped: the query's own mount already fetches, and
// refetching 300 ms into that load cancelled and restarted it — the page
// painted, then showed the buffering spinner and loaded a second time.
// Later focuses never cancel a fetch that's still in flight either.
type Refetch = (opts?: { cancelRefetch?: boolean }) => unknown;
export function useRefetchOnFocus(...refetches: Refetch[]) {
  const focusedOnce = useRef(false);
  const latest = useRef(refetches);
  useLayoutEffect(() => {
    latest.current = refetches;
  });
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnce.current) {
        focusedOnce.current = true;
        return;
      }
      // Deferred a beat so the newly focused screen paints before N network
      // requests and their re-renders compete with it (tab switches felt
      // laggy). Cancelled if the screen loses focus first.
      const t = setTimeout(() => latest.current.forEach((r) => r({ cancelRefetch: false })), 300);
      return () => clearTimeout(t);
    }, [])
  );
}

// The same "tabs stay mounted" behavior that leaves queries stale (see
// above) also leaves local component STATE stale — including whether a
// BottomSheetModal/Modal is open. Open a card's detail sheet on a tab,
// switch away, come back: react-navigation just refocuses the same mounted
// screen, so the sheet is still sitting there open with whatever it was
// last showing, instead of the screen resetting to its normal closed/list
// view. Pass a single cleanup callback that resets every "is a modal/sheet
// open" (and "what's currently open in it") state variable for the screen;
// it runs on BLUR (leaving the tab), not on focus, and needs no defer since
// resetting local state is instant.
export function useResetOnBlur(onBlur: () => void) {
  // `onBlur` is almost always passed as a fresh inline closure on every
  // render — if it were a useFocusEffect dependency, its changing identity
  // would tear the effect down and rerun it on EVERY render (not just on a
  // real blur), firing the "reset" cleanup immediately after every state
  // change, including the one that just opened the very modal this is meant
  // to guard. Routing it through a ref keeps the effect itself stable across
  // renders, so its cleanup only ever runs on an actual screen blur/unmount.
  const onBlurRef = useRef(onBlur);
  onBlurRef.current = onBlur;
  useFocusEffect(
    useCallback(() => {
      return () => onBlurRef.current();
    }, [])
  );
}
