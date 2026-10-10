import { useEffect, useState } from "react";

// Pull-to-refresh vs background reloads. Every screen refetches on focus
// (useRefetchOnFocus), and wiring RefreshControl straight to `isRefetching`
// made the pull-down indicator pop out on its own each time a page opened.
// Now the indicator only shows for a refresh the user pulled for. Any other
// reload is silent: the rows already on screen stay put and the fresh data
// swaps in when it lands (showing a spinner over data that's already there
// read as the page loading twice).
export function usePullRefresh(refreshing: boolean, onRefresh?: () => void) {
  const [pulled, setPulled] = useState(false);

  useEffect(() => {
    if (!refreshing) setPulled(false);
  }, [refreshing]);

  return {
    /** Feed RefreshControl.refreshing. */
    pullRefreshing: pulled && refreshing,
    /** Feed RefreshControl.onRefresh. */
    onPull: onRefresh
      ? () => {
          setPulled(true);
          onRefresh();
        }
      : undefined,
  };
}
