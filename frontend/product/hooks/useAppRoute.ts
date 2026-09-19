"use client";

import { useEffect, useState } from "react";
import { parsePath, ROUTE_CHANGE_EVENT, type ParsedPath } from "@/product/services/appRoutes";

export type AppRouteState = { route: string; arg?: string };

/**
 * The console's router: reads the current path and re-reads it whenever the
 * app navigates or the user presses Back.
 *
 * Replaces the old hash router (`location.hash` + `hashchange`). Real paths
 * cost more than fragments — the server has to serve the app shell for every
 * one of them, see webstatic's sluggedPage and next.config.ts's rewrites —
 * and buy what a fragment can never give: a URL the server sees, so a page
 * can be logged, proxied and linked like any other, and a browser that treats
 * a route change as navigation rather than an in-page jump.
 *
 * Two events, not one. `popstate` is the browser's (Back/Forward); pushState
 * deliberately does not fire it, so navigate() raises ROUTE_CHANGE_EVENT for
 * its own moves. Missing either one leaves the URL and the screen disagreeing
 * in one direction or the other.
 */
export function useAppRoute(): AppRouteState {
  const [state, setState] = useState<ParsedPath>(() => parsePath());

  useEffect(() => {
    // Read once on mount as well as on every event: the server-rendered
    // markup of a static export is built with no URL at all, so the first
    // client read is what establishes the real route.
    const update = () => setState(parsePath());
    update();
    window.addEventListener("popstate", update);
    window.addEventListener(ROUTE_CHANGE_EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(ROUTE_CHANGE_EVENT, update);
    };
  }, []);

  return { route: state.route, arg: state.arg };
}
