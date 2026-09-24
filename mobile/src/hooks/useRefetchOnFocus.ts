import { useCallback } from "react";
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
export function useRefetchOnFocus(...refetches: Array<() => void>) {
  useFocusEffect(
    useCallback(() => {
      // Deferred a beat so the newly focused screen paints before N network
      // requests and their re-renders compete with it (tab switches felt
      // laggy). Cancelled if the screen loses focus first.
      const t = setTimeout(() => refetches.forEach((r) => r()), 300);
      return () => clearTimeout(t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, refetches)
  );
}
