import { useEffect, useRef, useState } from "react";

// Pull-to-refresh vs background reloads. Every screen refetches on focus
// (useRefetchOnFocus), and wiring RefreshControl straight to `isRefetching`
// made the pull-down indicator pop out on its own each time a page opened.
// Now the indicator only shows for a refresh the user pulled for. Any other
// reload is silent: the rows already on screen stay put and the fresh data
// swaps in when it lands (showing a spinner over data that's already there
// read as the page loading twice).
export function usePullRefresh(refreshing: boolean, onRefresh?: () => void) {
  const [pulled, setPulled] = useState(false);
  // The indicator shows the moment the pull is released (it used to wait a render for the fetch to
  // report itself as started), and goes as soon as that fetch has finished.
  const started = useRef(false);
  useEffect(() => {
    if (refreshing) {
      started.current = true;
      return;
    }
    if (started.current) {
      started.current = false;
      setPulled(false);
    }
  }, [refreshing]);
  // A pull whose fetch never starts (deduped, offline) must not leave the indicator up.
  useEffect(() => {
    if (!pulled) return;
    const t = setTimeout(() => {
      if (!started.current) setPulled(false);
    }, 600);
    return () => clearTimeout(t);
  }, [pulled]);

  return {
    /** Feed RefreshControl.refreshing. */
    pullRefreshing: pulled,
    /** Feed RefreshControl.onRefresh. */
    onPull: onRefresh
      ? () => {
          setPulled(true);
          onRefresh();
        }
      : undefined,
  };
}
