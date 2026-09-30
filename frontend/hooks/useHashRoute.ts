"use client";

import { useEffect, useState } from "react";

export type HashRoute = { route: string; arg?: string };

function readHash(): HashRoute {
  if (typeof window === "undefined") return { route: "dashboard" };
  const hash = window.location.hash.replace("#", "") || "dashboard";
  const [route, arg] = hash.split("/");
  return { route, arg };
}

/**
 * Mirrors legacy/app.js's `router()` — reads `location.hash`, splits it into
 * `route/arg`, and re-reads on every `hashchange`. Kept as plain hash-based
 * navigation (not a router library) so in-app links (`#loan/GL-1001`, etc.)
 * stay exactly as shareable/bookmarkable as they are today.
 *
 * Always starts from the server-safe {route:"dashboard"} default rather than
 * reading location.hash during the initial render: `next dev` server-renders
 * this "use client" page too, where `window` doesn't exist, so the server's
 * markup is always the dashboard. If the client's own first render read the
 * real hash immediately (e.g. deep-linked to #cash), it would render a
 * DIFFERENT page than the server did in that same first pass — the classic
 * hydration mismatch, which then threw away and regenerated this whole
 * subtree. Deferring the real hash read to this effect (which only ever
 * runs after hydration) keeps the first client render identical to the
 * server's, and the real route swaps in a beat later exactly like any other
 * client-only state update — the same pattern BrandPreload/brand-preload.tsx
 * uses for its own unavoidable post-hydration DOM mutation.
 */
export function useHashRoute(): HashRoute {
  const [state, setState] = useState<HashRoute>({ route: "dashboard" });

  useEffect(() => {
    const update = () => setState(readHash());
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  return state;
}
